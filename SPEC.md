# SPEC: Harden auth & user endpoints (TDD)

## Context
A review of the request flow found these defects in the auth and user routes:

| # | Defect | Impact |
|---|---|---|
| 1 | `POST /auth/register` passes `req.body` straight to the DB, and no validation runs | Anyone can self-register with `"isAdmin": true` (privilege escalation) |
| 2 | `POST /user` and `PATCH /user/:id` store `password` without hashing | Plaintext passwords in the DB; those users can't log in |
| 3 | Login with an unknown email throws `NotFoundException` | Returns 404 instead of 401, which reveals which emails are registered |
| 4 | Wrong status codes and return values | Duplicate email → 500, `/user/abc` → 500, `PATCH` returns `UpdateResult`, bare `Error`s → 500 |
| 6 | `console.log` in `JwtStrategy` and `RolesGuard` | JWT payloads and user data (emails) logged on every request |

Out of scope: finding 5 (role taken from the JWT / `GET /user` open to all users) and finding 10 (dead code).

Branch: `feature/JIRA-<id>-harden-auth-user`. Conventional Commits.

## Gaps found while reviewing the first draft of this plan
These are now part of the plan:

| Gap | Why it matters | Resolution |
|---|---|---|
| **G1. Silent admin demotion.** `PartialType` from `@nestjs/mapped-types` copies property initializers (`inheritPropertyInitializers`). Once `ValidationPipe({ transform: true })` runs, `PATCH {"password": "..."}` becomes `{password, isAdmin: false}` | Any password change would demote an admin | Remove the `= false` initializer from `CreateUserDto` (the entity column already defaults to `false`). Add a test that a transformed `UpdateUserDto` has no `isAdmin` key |
| **G2. Email case.** The unique constraint is case-sensitive | `A@x.dev` and `a@x.dev` become two accounts, so the 409 check is bypassable, and login is case-sensitive | `@Transform` trim + lowercase on `email` in the DTO; lowercase `username` in `validateUser` |
| **G3. bcrypt truncates at 72 bytes** | Long passwords silently match on their first 72 bytes | `@MaxLength(72)` on `password` |
| **G4. Empty PATCH body** (`{}`) | TypeORM throws `UpdateValuesMissingError` → 500 | `update` throws `BadRequestException('No fields to update')` when the DTO has no keys |
| **G5. DB internals leak in 500 messages** (`` `Failed to ...: ${error.message}` ``) | Leaks SQL and constraint details to clients | Generic 500 message. Log the error with Nest `Logger` (no request body or PII) |
| **G6. 409 message** | Must not echo the email | `ConflictException('Email already in use')` |
| **G7. Timing-based enumeration** after the 404→401 fix | Unknown emails respond faster (no bcrypt work) | Compare against a dummy hash generated once with the same salt rounds |
| **G8. E2E harness is broken.** `test/jest-e2e.json` has no `moduleNameMapper` for `src/...` imports, and the only e2e test hits a non-existent, guarded `GET /` | The e2e red phase can't run at all | Add `"moduleNameMapper": {"^src/(.*)$": "<rootDir>/../src/$1"}` and replace the `GET /` test |
| **G9. No way to create an admin** once register can't set `isAdmin` | E2E admin scenarios have no admin; production has no bootstrap path | E2E: register a user, then set `isAdmin = true` via `DataSource` in `beforeAll`. Production bootstrap (seed script or CLI) is a **follow-up**; record it as an open issue |
| **G10. Existing bad data** | Plaintext passwords and users who self-promoted already exist in the DB | **Follow-up**: one-off script to bcrypt-hash any password not matching `^\$2[aby]\$`, an audit of `isAdmin = true` rows, and lowercasing existing `user.email` values. Legacy mixed-case rows (e.g. `A@x.dev`) would otherwise escape the case-insensitive 409 check and, after Cycle 3, fail to log in; any rows that collide once lowercased must be resolved by hand. Not part of this change |
| **G11. E2E isolation** | Tests write to the dev DB | Unique emails per run (`` `e2e-${Date.now()}-n@test.dev` ``), delete them in `afterAll`, and call `app.close()` |
| **G12. Login body isn't validated by the pipe** | Passport runs before pipes | Acceptable: passport-local returns 401 for missing fields. Covered by an e2e test |
| **G13. CI doesn't run e2e** | E2E regressions go unnoticed | DoD requires a local e2e run. Adding a Postgres service to CI is a follow-up |
| **G14. Explicit `null` on PATCH** (found in review) | `PartialType` applies `@IsOptional()`, which skips validation for `null` too. `PATCH /user/:id {"firstname": null}` reaches a NOT NULL column → 500; after Cycle 2, `{"password": null}` would reach `bcrypt.hash(null)` | `PartialType(CreateUserDto, { skipNullProperties: false })`: `null` is validated and rejected (400), omitted fields are still skipped. `CreateUserDto.isAdmin` uses `@ValidateIf((_, v) => v !== undefined)` instead of its own `@IsOptional()`, which would otherwise keep skipping `isAdmin: null` on both `POST /user` and `PATCH` |
| **G15. Zero-width-only names** (found in review) | `String.prototype.trim` doesn't strip U+200B and similar characters, so a name that looks blank is accepted | **Accepted**: cosmetic only, no security impact. Revisit if display names matter |

## Design decisions
- **Global strict validation.** `APP_PIPE` = `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` in `AppModule`, not `main.ts`, so e2e tests get it. The options live in `src/validation-pipe.options.ts` (`validationPipeOptions`) so a unit spec can exercise the same configuration.
- **Names are trimmed.** `firstname`/`lastname` get a trim `@Transform`, so whitespace-only names fail `@IsNotEmpty()`.
- **`UpdateUserDto`** = `PartialType(CreateUserDto, { skipNullProperties: false })`, so omitted fields are optional but `null` is rejected (G14).
- **`RegisterDto`** = `OmitType(CreateUserDto, ['isAdmin'] as const)`. `signUp` also forces `isAdmin: false`.
- **Hashing only in `UserService`** (`create` and `update`). `AuthService` no longer hashes. Salt rounds come from `JWT_SALT_OR_ROUNDS` (default 10).
- **`findOneByEmail` returns `User | null`.** Its only caller is `validateUser`.
- **Unique violation** (`QueryFailedError`, `driverError.code === '23505'`) → `ConflictException`. Any other DB error → `InternalServerErrorException`. No bare `Error`s.
- **`ParseIntPipe` on every `:id`** in `UserController`.

## TDD workflow
For each cycle: **Red** — write the tests and run them to confirm they fail for the expected reason (not a compile error elsewhere), then commit `test(<scope>): ...`. **Green** — make the smallest change that passes them, then commit `fix(<scope>): ...`. **Refactor** — clean up with the tests still green. Run `npm test` (and `npm run test:e2e` where listed) at every Red and Green step.

### Cycle 0: Harness (no behaviour change)
1. `npm i class-validator` (`class-transformer` is already installed).
2. `test/jest-e2e.json`: add `moduleNameMapper` (G8).
3. Replace the `GET /` test in `test/app.e2e-spec.ts` with a `test/auth-user.e2e-spec.ts` skeleton:
   - `beforeAll`: build the app from `AppModule`, get the `DataSource`, and create an admin (register, then flip `isAdmin` via the DataSource) (G9).
   - `afterAll`: delete the test users and call `app.close()` (G11).
   - Shared helpers: `register()`, `login()`, `authed()`.
4. Green check: `npm run test:e2e` runs (an empty or skeleton suite passes). Commit `test(e2e): fix harness and add auth/user suite skeleton`.

### Cycle 1: Validation & no self-promotion (finding 1, G1, G2, G3)
**Red**
- New `src/user/dto/create-user.dto.spec.ts`, using `plainToInstance` + `validate`:
  - Rejects a bad email, empty or whitespace-only names, and passwords shorter than 8 or longer than 72 characters.
  - Trims surrounding whitespace from names.
  - Accepts optional `isAdmin`, but rejects `isAdmin: null` (G14).
  - Lowercases and trims the email.
- New `src/auth/dto/register.dto.spec.ts`: `isAdmin` is not a known property. With `forbidNonWhitelisted`, validation errors on it.
- New `src/user/dto/update-user.dto.spec.ts`: `plainToInstance(UpdateUserDto, {password: 'x'.repeat(8)})` has **no `isAdmin` key** (G1). All fields are optional, but an explicit `null` on any field is rejected (G14).
- `src/auth/auth.service.spec.ts`: `signUp` calls `usersService.create` with `isAdmin: false`, even when the input contains `isAdmin: true`.
- `src/app.controller.spec.ts`: `register(dto)` passes the DTO to `signUp`.
- E2E:
  - Register with `isAdmin: true` → 400, and no row is created.
  - Register with an invalid email or short password → 400.
  - Register valid → 201, `isAdmin: false`, no `password` in the body.
  - Login with an empty body → 401 (G12).

**Green**
- Add validators to `src/user/dto/create-user.dto.ts` and remove its `= false` initializer.
- Add `src/auth/dto/register.dto.ts`.
- Add `APP_PIPE` in `src/app.module.ts`.
- `src/app.controller.ts`: `@Body() dto: RegisterDto`.
- `src/auth/auth.service.ts`: `signUp(dto: RegisterDto)` forces `isAdmin: false`.
- `src/user/dto/update-user.dto.ts`: `PartialType(CreateUserDto, { skipNullProperties: false })`; `CreateUserDto.isAdmin` uses `@ValidateIf((_, v) => v !== undefined)` instead of `@IsOptional()` (G14).

**Known interim gap (Cycles 1–3):** after Cycle 1, emails are stored lowercased, but `validateUser` still looks them up as typed until Cycle 3. A user registered as `Foo@Bar.dev` (stored `foo@bar.dev`) who logs in with `Foo@Bar.dev` gets a 404 until then. Cycle 1 must not be merged or deployed without Cycle 3; state this in the PR Test Plan.

### Cycle 2: Hash on every write path (finding 2)
**Red**
- `src/user/user.service.spec.ts`: provide a `ConfigService` mock and mock `bcrypt`. Tests:
  - `create` saves the hashed password, never the plaintext.
  - `update` hashes `password` when present and doesn't call `bcrypt.hash` when absent.
- `src/auth/auth.service.spec.ts`: `signUp` passes the plaintext password to `create` and doesn't call `bcrypt.hash` itself.
- E2E:
  - As admin, `POST /user` → the new user can log in. A DB read of that row shows `password` starting with `$2b$`.
  - As admin, `PATCH /user/:id {password}` → login with the new password succeeds and the user is still an admin if they were one (G1).

**Green**
- `src/user/user.service.ts`: inject `ConfigService` and add `hashPassword()`; use it in `create` and `update`.
- `src/auth/auth.service.ts`: remove `saltOrRounds` and the hashing.

### Cycle 3: Login 401 for unknown email (finding 3, G7)
**Red**
- `src/user/user.service.spec.ts`: `findOneByEmail` resolves `null` when the user is missing.
- `src/auth/auth.service.spec.ts`:
  - `validateUser` returns `null` for an unknown email **and still calls `bcrypt.compare`** (dummy hash).
  - It lowercases the email before the lookup.
- E2E: login with an unknown email and with a wrong password both return 401 with identical bodies.

**Green**
- `src/user/user.service.ts`: `findOneByEmail` returns `Promise<User | null>`.
- `src/auth/auth.service.ts`: dummy-hash compare when the user is missing.

### Cycle 4: Status codes & return values (finding 4, G4, G5, G6)
**Red**
- `src/user/user.service.spec.ts`:
  - `create` and `update` map a `QueryFailedError` with code `23505` → `ConflictException`, and a generic error → `InternalServerErrorException`, whose message doesn't contain the DB error text.
  - `update` returns the reloaded `User`, throws `NotFoundException` for an unknown id, and throws `BadRequestException` for an empty DTO.
  - `remove` throws `NotFoundException` / `InternalServerErrorException`.
- `src/auth/auth.service.spec.ts`: `signUp` propagates `ConflictException` unchanged.
- `src/user/user.controller.spec.ts`: methods take numeric ids (`findOne(1)`, `update(1, dto)`, `remove(2)`).
- E2E:
  - Duplicate register (including a different email case) → 409.
  - PATCH to an existing email → 409.
  - `GET /user/abc` → 400.
  - `PATCH /user/:id` returns the user without `password`.
  - `PATCH {}` → 400.

**Green**
- `src/user/user.service.ts`: error mapping, `await` inside `try`, return `findOne(id)`, empty-DTO guard, `Logger` for 500s, and remove the dead `if (!user)` checks.
- `src/auth/auth.service.ts`: remove the try/catch in `signUp`.
- `src/user/user.controller.ts`: `ParseIntPipe`.

### Cycle 5: Remove sensitive logging (finding 6)
**Red**
- `src/auth/jwt.strategy.spec.ts` (new): `validate` maps the payload and does **not** call `console.log` (`jest.spyOn(console, 'log')`).
- `src/auth/role.guard.spec.ts` (new):
  - Admin is allowed and non-admin is denied on `@Roles(ADMIN)`.
  - No `@Roles` → allowed.
  - `console.log` is not called.

**Green**
- Delete the `console.log` lines in `src/auth/jwt.strategy.ts` and `src/auth/role.guard.ts`.

### Final refactor
- Run `npm run format` and `npx eslint "{src,apps,libs,test}/**/*.ts"`.
- Update the CLAUDE.md Architecture notes on global validation (including `src/validation-pipe.options.ts`), `RegisterDto` and where hashing lives.

## Files touched (summary)
- **Modified:**
  - `package.json`, `package-lock.json`
  - `test/jest-e2e.json`
  - `src/app.module.ts`, `src/app.controller.ts`
  - `src/auth/auth.service.ts`, `src/auth/jwt.strategy.ts`, `src/auth/role.guard.ts`
  - `src/user/user.service.ts`, `src/user/user.controller.ts`, `src/user/dto/create-user.dto.ts`, `src/user/dto/update-user.dto.ts`
  - Existing specs: `auth.service`, `user.service`, `user.controller`, `app.controller`
  - `CLAUDE.md`
- **New:**
  - `src/auth/dto/register.dto.ts`
  - `src/validation-pipe.options.ts` and `src/validation-pipe.options.spec.ts`
  - DTO specs ×3
  - `src/auth/jwt.strategy.spec.ts`, `src/auth/role.guard.spec.ts`
  - `test/auth-user.e2e-spec.ts`
- **Removed:** `test/app.e2e-spec.ts`, replaced by the new suite.

## Definition of done
1. `POST /auth/register` with `isAdmin` in the body returns **400**, and no row is created.
2. All users created via register, `POST /user` or `PATCH /user/:id` have bcrypt hashes (`$2b$...`) in `user.password`. `PATCH` with only `password` doesn't change `isAdmin`.
3. Login with an unknown email returns **401**, with a body identical to a wrong-password attempt.
4. The following all hold:
   - A duplicate email (case-insensitive) returns **409** on register, `POST /user` and `PATCH`.
   - A non-numeric `:id` returns **400**, and so does an empty PATCH body.
   - `PATCH` returns the updated user without `password`.
   - No 500 response body contains DB error text.
   - `grep -rn "new Error(" src` is empty.
5. `grep -rn "console.log" src` is empty.
6. Every cycle has a `test:` commit that failed before its `fix:` commit. All of the following pass:
   - `npx eslint "{src,apps,libs,test}/**/*.ts"`
   - `npm test`
   - `npm run build`
   - `npm run test:e2e` (local DB)
7. Follow-ups are recorded as issues: admin bootstrap (G9), rehash/audit/email-lowercasing of existing data (G10) and e2e in CI (G13).

## Verification
1. Per cycle: `npm test -- <pattern>` fails at Red and passes at Green. Capture both outputs in the PR Test Plan.
2. Final: `npx eslint "{src,apps,libs,test}/**/*.ts"` → `npm test` → `npm run build` → `docker compose up -d && npm run test:e2e`.
3. Manual smoke test with `npm run start:dev` and curl:
   - Register with `isAdmin` → 400.
   - Register → 201.
   - Register the same email in a different case → 409.
   - Login with an unknown email → 401.
   - `GET /user/abc` with a token → 400.
   - The server console shows no JWT payloads or user objects.
