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
| **G7. Timing-based enumeration** after the 404→401 fix | Unknown emails respond faster (no bcrypt work) | Compare against a dummy hash generated once with the same salt rounds. It is started at startup (`onModuleInit`, not awaited) so the first unknown-email login isn't measurably slower (review measured 123 ms vs ~50 ms when lazy). A failed hash is not cached, so it is retried rather than turning every unknown email into a 500. **Residual (accepted, see G10):** accounts hashed at a different cost, or still holding plaintext passwords, respond at a different speed |
| **G8. E2E harness is broken.** `test/jest-e2e.json` has no `moduleNameMapper` for `src/...` imports, and the only e2e test hits a non-existent, guarded `GET /` | The e2e red phase can't run at all | Add `"moduleNameMapper": {"^src/(.*)$": "<rootDir>/../src/$1"}` and replace the `GET /` test |
| **G9. No way to create an admin** once register can't set `isAdmin` | E2E admin scenarios have no admin; production has no bootstrap path | E2E: register a user, then set `isAdmin = true` via `DataSource` in `beforeAll`. Production bootstrap (seed script or CLI) is a **follow-up**; record it as an open issue |
| **G10. Existing bad data** | Plaintext passwords and users who self-promoted already exist in the DB | **Follow-up**: one-off script to bcrypt-hash any password not matching `^\$2[aby]\$`, an audit of `isAdmin = true` rows, and lowercasing existing `user.email` values. Plaintext and differently-costed hashes also make login timing distinguishable (G7); consider rehash-on-login when the stored cost differs from `JWT_SALT_OR_ROUNDS`. Legacy mixed-case rows (e.g. `A@x.dev`) would otherwise escape the case-insensitive 409 check and, after Cycle 3, fail to log in; any rows that collide once lowercased must be resolved by hand. Not part of this change |
| **G11. E2E isolation** | Tests write to the dev DB | Unique emails per run (`` `e2e-${Date.now()}-n@test.dev` ``), delete them in `afterAll`, and call `app.close()` |
| **G12. Login body isn't validated by the pipe** | Passport runs before pipes | Acceptable: passport-local returns 401 for missing fields. Covered by an e2e test |
| **G13. CI doesn't run e2e** | E2E regressions go unnoticed | DoD requires a local e2e run. Adding a Postgres service to CI is a follow-up |
| **G14. Explicit `null` on PATCH** (found in review) | `PartialType` applies `@IsOptional()`, which skips validation for `null` too. `PATCH /user/:id {"firstname": null}` reaches a NOT NULL column → 500; after Cycle 2, `{"password": null}` would reach `bcrypt.hash(null)` | `PartialType(CreateUserDto, { skipNullProperties: false })`: `null` is validated and rejected (400), omitted fields are still skipped. `CreateUserDto.isAdmin` uses `@ValidateIf((_, v) => v !== undefined)` instead of its own `@IsOptional()`, which would otherwise keep skipping `isAdmin: null` on both `POST /user` and `PATCH` |
| **G15. Zero-width-only names** (found in review) | `String.prototype.trim` doesn't strip U+200B and similar characters, so a name that looks blank is accepted | **Accepted**: cosmetic only, no security impact. Revisit if display names matter |
| **G16. Unvalidated `JWT_SALT_OR_ROUNDS`** (found in review) | `Number(v) \|\| 10` only falls back for unset/`0`/non-numeric. `"1"`, `"4.5"` silently give bcrypt cost 4 (weak hashes); `"-1"`, `"20"`, `"31"` hang hashing, and concurrent password writes exhaust the libuv threadpool and stall logins | `UserService` reads it once at construction: unset or empty → 10; otherwise it must be an integer 10–15, else the constructor throws an `Error` naming `JWT_SALT_OR_ROUNDS` so the app fails at startup (a startup config error, not an HTTP error, so a plain `Error` is acceptable here) |
| **G17. Out-of-range ids** (found in review) | `ParseIntPipe` accepts any integer, but `user.id` is a Postgres `integer`. `/user/2147483648` (pg 22003) and `/user/99999999999999999999999` (22P02) fail in `findOne`, outside the error mapping, so the client gets a 500. Nest's default handler then logs the full `QueryFailedError` | `ParseIdPipe` (`src/pipes/parse-id.pipe.ts`) delegates to `ParseIntPipe` (non-numeric → 400 `Validation failed (numeric string is expected)`), then rejects ids outside 1–2147483647 with 400 `Validation failed (id must be between 1 and 2147483647)`. `0` and negative ids change from 404 to 400 |
| **G18. Any 23505 → 409** (found in review) | `email` is the only unique column besides the PK. A PK collision after sequence drift (manual seed, restore) would report "Email already in use" | **Accepted**: matching is by SQLSTATE code, not message text, so it is locale-independent. Revisit if another unique column is added; then match `driverError.constraint` against a named email constraint |
| **G19. Unwrapped read paths log full DB errors** (found in review) | `findOne`, `findAll` and `findOneByEmail` (login) aren't wrapped by `toHttpError`. A DB failure there reaches Nest's `ExceptionsHandler`, which logs the whole `QueryFailedError`, including `parameters` (the submitted email on login). The response stays a generic 500 | **Follow-up**: a global exception filter that logs only name/message/stack, or wrap the reads |
| **G20. Register 409 reveals registered emails** (found in review) | G6/DoD 4 require 409 on duplicate register, which partly undoes Cycle 3's enumeration fix for login | **Accepted by spec; follow-up**: rate limiting, or a neutral response plus email verification |

## Design decisions
- **Global strict validation.** `APP_PIPE` = `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` in `AppModule`, not `main.ts`, so e2e tests get it. The options live in `src/validation-pipe.options.ts` (`validationPipeOptions`) so a unit spec can exercise the same configuration.
- **Names are trimmed.** `firstname`/`lastname` get a trim `@Transform`, so whitespace-only names fail `@IsNotEmpty()`.
- **`UpdateUserDto`** = `PartialType(CreateUserDto, { skipNullProperties: false })`, so omitted fields are optional but `null` is rejected (G14).
- **`RegisterDto`** = `OmitType(CreateUserDto, ['isAdmin'] as const)`. `signUp` also forces `isAdmin: false`.
- **Hashing only in `UserService`** (`create` and `update`). `AuthService` no longer hashes. Salt rounds come from `JWT_SALT_OR_ROUNDS` (default 10), validated once at startup as an integer 10–15 (G16).
- **`findOneByEmail` returns `User | null`.** Its only caller is `validateUser`.
- **Unique violation** (`QueryFailedError`, `driverError.code === '23505'`) → `ConflictException`. Any other DB error → `InternalServerErrorException`. No bare `Error`s.
- **`ParseIdPipe` on every `:id`** in `UserController`. It wraps `ParseIntPipe` and adds the Postgres `integer` range check (G17).

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

**Known interim gap (Cycles 1–3), resolved in Cycle 3:** after Cycle 1, emails are stored lowercased, but `validateUser` still looks them up as typed until Cycle 3. A user registered as `Foo@Bar.dev` (stored `foo@bar.dev`) who logs in with `Foo@Bar.dev` gets a 404 until then. Cycle 1 must not be merged or deployed without Cycle 3; state this in the PR Test Plan.

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
  - Validate `JWT_SALT_OR_ROUNDS` once in the constructor (G16).
  - In `update`, hash when `password != null`. The DTO already rejects `null` over HTTP; this guards non-HTTP callers.
- `src/auth/auth.service.ts`: remove `saltOrRounds` and the hashing. The `ConfigService` constructor parameter stays for now (see the Cycle 3 note).

**Review-driven test hardening:**
- Input-dependent `bcrypt.hash` stub, so double hashing is caught.
- Exact `repo.update` payloads.
- Frozen DTOs, so in-place mutation is caught.
- `jest.resetAllMocks()` in `beforeEach`.
- `auth.service.spec.ts` built with `Test.createTestingModule`.
- E2E: a hash check after PATCH, the G1 precondition, and no `password` in the `POST /user` response.

### Cycle 3: Login 401 for unknown email (finding 3, G7)
**Red**
- `src/user/user.service.spec.ts`: `findOneByEmail` resolves `null` when the user is missing.
- `src/auth/auth.service.spec.ts`:
  - `validateUser` returns `null` for an unknown email **and still calls `bcrypt.compare`** (dummy hash).
  - The dummy hash must use the same salt rounds as real hashes. **Decision:** `UserService.hashPassword` becomes public and is the one source of salt rounds (G16). `AuthService` builds the dummy hash from it once, caching the promise per instance, and never re-reads `JWT_SALT_OR_ROUNDS`. `AuthService` drops its unused `ConfigService` parameter.
  - The dummy hash is started once at startup (`onModuleInit`) and reused. Without init it is computed lazily, once, even under concurrent logins, and not at all for known users. A rejected hash is retried, never cached, and a failure at startup doesn't throw.
  - It trims and lowercases the email before the lookup.
  - A non-string `username` or `password` returns `null` (401) before any lookup. Login bypasses the ValidationPipe, and `.trim()` / `bcrypt.compare` would otherwise throw a 500 (found in review).
- E2E:
  - Login with an unknown email and with a wrong password both return 401 with identical bodies (`{ statusCode: 401, message: 'Unauthorized' }`).
  - Login with a differently cased and padded email succeeds. This closes the Cycle 1–3 interim gap.
  - A non-string `username` or `password` returns 401.

**Green**
- `src/user/user.service.ts`: `findOneByEmail` returns `Promise<User | null>`, and `hashPassword` is public.
- `src/auth/auth.service.ts`:
  - Normalise the email.
  - Dummy-hash compare when the user is missing, using the cached `usersService.hashPassword(<random>)`.
    - The cache is cleared on rejection.
    - It is warmed in `onModuleInit` without being awaited, and errors there are swallowed.
  - Return `null` early for non-string credentials.
  - Remove the `ConfigService` constructor parameter.

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

**Decisions:**
- **Empty `PATCH`.** A body with no defined fields gets `BadRequestException('No fields to update')` before any DB call or hashing. That's cheaper and doesn't depend on the user existing.
- **500 logging.** It goes through `Logger` with the error's name, message and stack only, never TypeORM's `query`/`parameters` (they hold the email and the password hash). The response message is generic: `Failed to <create|update|remove> user`.
- **HTTP exceptions** (e.g. `NotFoundException`) pass through the mapping unchanged.
- **`signUp`.** Loses both its try/catch and its `if (!payload)` bare `Error`; the ValidationPipe guarantees a body. `UserService` errors propagate unchanged, so the old "throw an error for an invalid user" test is replaced by propagation tests.
- **`findAll`'s dead `!users` check** stays; it's dead code (finding 10), out of scope.

**Green**
- `src/user/user.service.ts`: error mapping, `await` inside `try`, return `findOne(id)`, empty-DTO guard, `Logger` for 500s, and remove the dead `if (!user)` checks.
- `src/auth/auth.service.ts`: remove the try/catch in `signUp`.
- `src/user/user.controller.ts`: `ParseIdPipe` (new `src/pipes/parse-id.pipe.ts`, G17).
- `toHttpError` returns `HttpException`, and non-`Error` throws are normalised before logging.

**Review-driven test hardening:**
- HTTP-exception passthrough.
- A falsy-but-defined PATCH (`{ isAdmin: false }`).
- 23505 vs. other codes, matched by code rather than message.
- Log content and the absence of the query.
- Hash and DB failures on update.
- A plain `Error` propagating through `signUp`.
- Recased `POST /user` 409.
- Exact `ParseIntPipe` messages, and e2e id-range cases.

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
  - `src/pipes/parse-id.pipe.ts` and `src/pipes/parse-id.pipe.spec.ts`
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
   - `grep -rn --exclude='*.spec.ts' "new Error(" src` matches only the G16 startup config check in `user.service.ts` (tests construct errors legitimately).
5. `grep -rn "console.log" src` is empty.
6. Every cycle has a `test:` commit that failed before its `fix:` commit. All of the following pass:
   - `npx eslint "{src,apps,libs,test}/**/*.ts"`
   - `npm test`
   - `npm run build`
   - `npm run test:e2e` (local DB)
7. Follow-ups are recorded as issues: admin bootstrap (G9), rehash/audit/email-lowercasing of existing data (G10), e2e in CI (G13), logging on unwrapped read paths (G19) and register email enumeration (G20).

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
