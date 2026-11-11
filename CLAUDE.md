# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

Movie Reservation System: a REST API backend where users sign up, browse movies and showtimes, and reserve seats. Admins manage movies, showtimes and users, and view reservation reports.

## Commands

```bash
nvm use                     # Node 24 from .nvmrc
npm ci
docker compose up -d        # Postgres; reads DB_* from .env
npm run start:dev           # watch mode, default port 3000 (PORT env)
npm run build               # nest build -> dist/
npm test                    # unit tests (src/**/*.spec.ts); jest via node --experimental-vm-modules
npm test -- user.service    # single test file by name pattern
npm run test:e2e            # e2e (test/*.e2e-spec.ts), needs a running DB
npm run test:cov
npm run lint                # eslint WITH --fix
npm run format              # prettier --write src + test
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on push/PR to `main` with the Node version from `.nvmrc`: `npm ci` → `npx eslint "{src,apps,libs,test}/**/*.ts"` (no `--fix`) → `npm test` → `npm run build`. Run the same three checks locally before committing.

### Environment variables

Loaded via `ConfigModule.forRoot({ isGlobal: true, cache: true })` from `.env` (git-ignored; never read or commit it).

| Variable                                                      | Used by                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | TypeORM ([src/app.module.ts](src/app.module.ts)) and docker-compose                                                |
| `JWT_SECRET`, `JWT_EXPIRATION`                                | `JwtModule` / `JwtStrategy`; **required** (read with `getOrThrow`, so the app fails at startup if they're missing) |
| `JWT_SALT_OR_ROUNDS`                                          | bcrypt salt rounds in `UserService`; integer 10–15 (default 10), validated once, else the app fails at startup     |
| `PORT`                                                        | HTTP port (default 3000)                                                                                           |

## Architecture

```
src/
  main.ts                  bootstrap
  app.module.ts            TypeORM config, global guards (APP_GUARD) and ValidationPipe (APP_PIPE)
  validation-pipe.options.ts  shared ValidationPipe options (whitelist, forbidNonWhitelisted, transform)
  app.controller.ts        POST /auth/login, POST /auth/register
  auth/                    AuthService, Passport local + JWT strategies, guards, dto/register.dto.ts
  user/                    UserModule: controller, service, dto/, entities/
  pipes/                   ParseIdPipe (numeric ids within the Postgres integer range)
  decorators/              @Public(), @Roles(...), @IdParam()
  types/index.ts           shared enums (Role)
test/                      e2e tests + jest-e2e.json; utils/ holds shared test helpers
```

- **Auth is global.** `JwtAuthGuard` and `RolesGuard` are registered as `APP_GUARD`, so every route requires a Bearer JWT unless marked `@Public()`. Restrict to admins with `@Roles(Role.ADMIN)`.
- **Validation is global and strict.** `APP_PIPE` applies `validationPipeOptions`, so request bodies must match their DTO's class-validator rules and unknown fields get a 400. Register with `RegisterDto` (no `isAdmin`); `signUp` also forces `isAdmin: false`. Login (passport-local) runs before pipes, so `AuthService.validateUser` type-checks its own inputs and rejects NUL bytes. Names reject NUL bytes too, because Postgres text columns can't store U+0000.
- **Params:** with `transform: true`, the global pipe coerces `@Param`/`@Query` values typed `number` with `+value`, so `0x10` becomes 16 before any param pipe sees it. Use `@IdParam()` from `src/decorators/id-param.decorator.ts` for `:id`. It is a custom decorator, so the global pipe skips it and `ParseIdPipe` receives the raw string: decimal digits only, in the range 1–2147483647.
- **Passwords** are hashed only in `UserService` (`create`, `update`, and the public `hashPassword`). Never hash elsewhere, and never store a plaintext password.
- **Login** trims and lowercases the email, and returns the same 401 for unknown emails and wrong passwords. An unknown email is compared against a dummy hash (warmed in `onModuleInit`), so the two cases take comparable time.
- **Roles** are derived from `User.isAdmin` (boolean), mapped to the `Role` enum (`user` | `admin`) in `RolesGuard`. The JWT payload is `{ email, sub: id, isAdmin }`, and `JwtStrategy.validate` exposes `req.user = { id, username, isAdmin }`.
- **Persistence:** TypeORM repositories injected with `@InjectRepository(Entity)`. Each entity must be registered both in the feature module (`TypeOrmModule.forFeature([...])`) and in the `entities` array in `app.module.ts`. `synchronize: true` is on (dev only; no migrations yet).
- **Serialization:** sensitive columns use `@Exclude()` (e.g. `User.password`). Controllers that return entities need `@UseInterceptors(ClassSerializerInterceptor)`.

## Code formatting & conventions

### Tooling (enforced)

- **Prettier** ([.prettierrc](.prettierrc)): `singleQuote: true`, `trailingComma: "all"`; otherwise defaults (2-space indent, semicolons, 80-col print width, double quotes never used in TS).
- **ESLint** ([.eslintrc.js](.eslintrc.js)): `@typescript-eslint/recommended` + `plugin:prettier/recommended` (Prettier violations are lint errors). Off: `explicit-function-return-type`, `explicit-module-boundary-types`, `no-explicit-any`, `interface-name-prefix`. `no-unused-vars` is an error, but `ignoreRestSiblings: true` allows `const { password, ...rest } = user`.
- **TypeScript** ([tsconfig.json](tsconfig.json)): `strictNullChecks`, `noImplicitAny`, decorators + metadata enabled, target ES2021, CommonJS.

### Patterns to follow

- **Module layout:** one feature folder per domain (`src/<feature>/`) with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `dto/create-<feature>.dto.ts`, `dto/update-<feature>.dto.ts`, `entities/<feature>.entity.ts`, and co-located `*.spec.ts`. Generate with `npx nest g resource <name>`.
- **Naming:** kebab-case files with Nest suffixes (`.module`, `.controller`, `.service`, `.guard`, `.strategy`, `.decorator`, `.pipe`, `.dto`, `.entity`); PascalCase classes (`UserService`, `CreateUserDto`); singular entity names (`User`) and singular route prefixes (`@Controller('user')`). Enums are PascalCase with UPPER_CASE members (`Role.ADMIN = 'admin'`) in `src/types`.
- **Imports:** both `src/...` absolute paths (mapped in Jest via `moduleNameMapper`) and relative paths are used; prefer relative within a feature and `src/...` across features. Use `import * as bcrypt from 'bcrypt'` for CommonJS libs.
- **DI:** constructor injection with `private readonly`; repositories via `@InjectRepository(Entity) private <name>Repository: Repository<Entity>`.
- **DTOs:**
  - `Update*Dto extends PartialType(Create*Dto, { skipNullProperties: false })` from `@nestjs/mapped-types`. The option makes explicit `null` fail validation (400) instead of reaching a NOT NULL column (500).
  - For optional fields on the create DTO, use `@ValidateIf((_, v) => v !== undefined)` rather than `@IsOptional()`, which also lets `null` through.
  - Use `OmitType` for narrower request DTOs, e.g. `RegisterDto`.
  - Don't give DTO fields initializers: `PartialType` copies them, so a default would silently be written on every PATCH.
- **Controllers stay thin:** delegate to services; no business logic or repository access in controllers.
- **Errors:**
  - Throw Nest HTTP exceptions from services, e.g. `NotFoundException` with messages like `User with ID ${id} not found`.
  - Map DB errors by SQLSTATE code, not message text: `23505` → `ConflictException`. Anything else gets a generic `InternalServerErrorException` (`Failed to <action> user`) with no DB text (see `UserService.toHttpError`).
  - Do not throw bare `Error` in request paths; it becomes a 500 with no useful message. Startup config validation is the one exception.
- **Logging:**
  - Never log request bodies, JWT payloads, `req.user`, emails or password hashes. No `console.*` in production code.
  - Known gap (SPEC G19): an unexpected DB failure on an unwrapped read path (`findOne`, `findAll`, `findOneByEmail`) still reaches Nest's default exception handler, which logs the whole `QueryFailedError`, including its parameters.
  - Use Nest `Logger`, logging only an error's name, message and stack, never TypeORM's `query` or `parameters`.
- **Library type mismatches:** when a config string must satisfy a narrower library type, cast at the call site with that library's own type (e.g. `as JwtSignOptions['expiresIn']` in [src/auth/auth.module.ts](src/auth/auth.module.ts)) rather than `any`.
- **Async:** `async/await` everywhere; annotate service return types (`Promise<User>`).
- **Config:** read config via `ConfigService`, never `process.env` outside `main.ts`. Use `configService.getOrThrow<string>('KEY')` for required values (NestJS 12's `@nestjs/jwt` and `passport-jwt` types reject `string | undefined`), and `get<T>()` only when there's a fallback (e.g. `JWT_SALT_OR_ROUNDS`). Use `forRootAsync`/`registerAsync` + `useFactory` for config-driven modules.
- **Metadata decorators:** export a key constant plus a `SetMetadata` wrapper (see [src/decorators/](src/decorators/)).

### Testing

- Unit tests are co-located as `*.spec.ts` and run by Jest with `rootDir: src`.
- For DI providers (services, strategies, guards) and controllers, build the module with `Test.createTestingModule` and provide mocks with `{ provide: X, useValue: mockX }`; repositories use `getRepositoryToken(Entity)`.
- DTO, pipe and options specs (e.g. `*.dto.spec.ts`, `parse-id.pipe.spec.ts`, `validation-pipe.options.spec.ts`) construct their classes directly (`plainToInstance` + `validate`, `new ParseIdPipe()`, `new ValidationPipe(validationPipeOptions)`), with no testing module.
- Mocks are plain objects of `jest.fn()`. Call `jest.resetAllMocks()` at the top of `beforeEach`, then re-stub defaults, so `*Once` stubs can't leak between tests.
- Make stubs input-dependent where a constant would hide bugs, e.g. `bcrypt.hash` → `hashed(${plain},${rounds})` catches double hashing.
- To assert nothing sensitive is logged, use `spyOnAllLogging()` from `test/utils/spy-on-logging.ts`, which covers every `console` and Nest `Logger` channel.
- Group by method with `describe('<method>')`; name tests `it('should ...')`.
- Cover error paths (e.g. `rejects.toThrow(NotFoundException)`) and assert the calls passed to collaborators, not just return values.

## Git

- Conventional Commits: `<type>(<scope>): <subject>`. Types: feat, fix, chore, docs, refactor, test.
- Branch names: `feature/JIRA-123-short-description`.
- PRs must include: Summary, Test Plan, linked issue.

## IMPORTANT

- **Sanitize External Inputs:** Always perform strict parsing, typing, and validation boundaries prior to shell execution or system calls before processing data from external web requests, third-party APIs, file uploads, and database queries.
- **Protect Confidential Credentials:** Redact and mask all environment variables, API keys, certificates, and `.env` contents from logs, git diffs, terminal outputs, and generated files at all times.
- **Obtain Explicit Authorization:** Confirm destructive operations (such as recursive deletions, force pushes, database drops, or remote script executions) with the user before executing.
