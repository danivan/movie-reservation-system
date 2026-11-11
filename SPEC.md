# SPEC: Movie module

## Goal
- Anyone can browse movies, with or without logging in. Admins can create, update and delete them.
- Follow the patterns of the `user` module and [CLAUDE.md](CLAUDE.md).
- Gap IDs (G1, G9, G17, G21) refer to the earlier auth-hardening spec: `git show 18203cb:SPEC.md`.

## Out of scope
- Pagination, title search, multiple genres per movie, `createdAt`/`updatedAt` columns.
- Delete behaviour once showtimes reference movies (decide this in the showtime spec).
- Refactoring `UserService` (e.g. a shared `toHttpError`).

## Requirements

### Data: `Movie` entity (`src/movie/entities/movie.entity.ts`)
- `id`: serial PK.
- `title`: `varchar(200)`, required, **not unique** (remakes share titles).
- `description`: `text`, required.
- `durationMinutes`: `int`, required.
- `genre`: Postgres enum of the new `Genre` enum, required.
- `releaseDate`: `date`, returned as a `'YYYY-MM-DD'` string.
- `posterUrl`: `varchar(2048)`, nullable. Declare `type: 'varchar'` explicitly, because the field is typed `string | null`.
- `Genre` goes in [src/types/index.ts](src/types/index.ts) after line 4: `action`, `animation`, `comedy`, `documentary`, `drama`, `horror`, `romance`, `sci-fi`, `thriller`.

### Endpoints (`@Controller('movie')`)
- `GET /movie`: `@Public()`.
  - Optional `?genre=<Genre>` filter.
  - Ordered by `title ASC, id ASC`.
  - Returns `[]` when nothing matches (not a 404).
- `GET /movie/:id`: `@Public()`. Returns 404 `Movie with ID ${id} not found` when it doesn't exist.
- `POST /movie`: `@Roles(Role.ADMIN)`. Returns 201 with the created movie.
- `PATCH /movie/:id`: `@Roles(Role.ADMIN)`. Returns 200 with the movie **reloaded** from the DB.
- `DELETE /movie/:id`: `@Roles(Role.ADMIN)`. Returns 200 with an empty body, the same as `DELETE /user/:id`.
- Every `:id` uses `@IdParam()` (G17), so `abc`, `0`, `0x10`, `1e3` and `2147483648` all give 400.
- Writes without a token give 401; writes from a non-admin give 403.

### Validation (`CreateMovieDto`, `UpdateMovieDto`, `FindMoviesQueryDto`)
- `title`: trimmed, non-empty, at most 200 characters, no NUL.
- `description`: trimmed, non-empty, at most 5000 characters, no NUL.
- `durationMinutes`: an integer from 1 to 600.
  - The string `'120'` is rejected; there is no implicit conversion.
- `genre`: `@IsEnum(Genre)`.
- `releaseDate`:
  - Must match `^(18|19|20|21)\d{2}-\d{2}-\d{2}$` and pass `@IsISO8601({ strict: true })`.
  - Rejects `2021-02-29`, `0000-01-01` and datetimes. Verified against the installed class-validator.
- `posterUrl`: optional, an `https` URL with the protocol included, at most 2048 characters.
  - `null` is allowed and clears the poster.
  - Use `@ValidateIf((_, v) => v !== undefined && v !== null)`. Verified to work alongside `PartialType`.
- `UpdateMovieDto` is `PartialType(CreateMovieDto, { skipNullProperties: false })`.
  - An explicit `null` is rejected on every field except `posterUrl`.
- No field initializers on any DTO (G1).
- `FindMoviesQueryDto`: `genre` is optional and must be a `Genre` value.
  - A repeated `?genre=a&genre=b`, an empty `?genre=` or an unknown query key gives 400.
- An unknown body key, `id` included, gives 400 (global `forbidNonWhitelisted`).

### Service (`MovieService`)
- Mirrors [src/user/user.service.ts](src/user/user.service.ts), without the hashing or config.
- `update`:
  - Throws 400 `No fields to update` when every value is `undefined`, before any DB call.
  - `{ posterUrl: null }` is **not** empty.
  - Then it checks the movie exists (404), updates, and returns `findOne(id)`.
- `remove`: checks the movie exists (404), then deletes it.
- Write errors (`create`, `update`, `remove`):
  - An `HttpException` passes through unchanged.
  - Anything else becomes 500 `Failed to <action> movie`. That includes `23505`; there's no 409, because `movie` has no unique column.
- Logging on a failed write: Nest `Logger` with the error's name, message and stack only (cf. `user.service.ts:119-144`). No TypeORM `query` or `parameters`.
- Don't copy the dead `if (!users)` check from `user.service.ts:60-62`.

## Files

### Modify
- [src/user/dto/create-user.dto.ts:13-21](src/user/dto/create-user.dto.ts#L13-L21): move `trim`, `NO_NUL` and `NO_NUL_OPTIONS` (and their G21 comment) to a new `src/common/string-validation.ts`, and import them from there. No behaviour change.
- [src/types/index.ts](src/types/index.ts): add `Genre` after line 4.
- [src/app.module.ts](src/app.module.ts):
  - Line 7: import `Movie` and `MovieModule`.
  - Line 25: `entities: [User, Movie]`.
  - Line 30: add `MovieModule` after `UserModule`.
- [src/pipes/parse-id.pipe.ts:9](src/pipes/parse-id.pipe.ts#L9): the comment should say the limit is the column type of every serial `id`, not just `user.id`.
- [package.json](package.json): add `--runInBand` to `test:e2e`. Both e2e suites boot `AppModule` with `synchronize: true`, and on a cold DB they raced to create the `movie` table and enum.
- [CLAUDE.md](CLAUDE.md), Architecture block: add `common/` and `movie/` to the tree, and note the pattern of `@Public()` reads with `@Roles(Role.ADMIN)` writes.

### Add
- `src/common/string-validation.ts`
- `src/movie/`:
  - `movie.module.ts`: `forFeature([Movie])`, `exports: [MovieService]`.
  - `movie.controller.ts`, `movie.service.ts`, `entities/movie.entity.ts`.
  - `dto/create-movie.dto.ts`, `dto/update-movie.dto.ts`, `dto/find-movies-query.dto.ts`.
- Specs:
  - `src/movie/movie.service.spec.ts`, `src/movie/movie.controller.spec.ts`.
  - `src/movie/dto/*.dto.spec.ts` (one per DTO).
  - `test/movie.e2e-spec.ts`.

## Acceptance criteria

### Unit (`npm test`)
- **Refactor guard:** the existing `create-user.dto.spec.ts`, `update-user.dto.spec.ts` and `register.dto.spec.ts` pass **unchanged**.
- **`create-movie.dto.spec.ts`:**
  - Boundaries pass and fail exactly at the limits: title 200/201, description 5000/5001, duration 1/600 vs 0/601/90.5/`'120'`.
  - The `releaseDate` cases above.
  - `posterUrl`: `http://`, no protocol, `javascript:`, and 2049 characters all fail; omitted or `null` passes.
  - Trims names; rejects NUL.
  - Every `Genre` value passes; `'Action'` fails.
- **`update-movie.dto.spec.ts`:**
  - `{ title: 'x' }` transforms to an object with only `title`.
  - `null` fails on every field except `posterUrl`.
  - `{}` passes; the service rejects it, not the DTO.
- **`find-movies-query.dto.spec.ts`:** `{}` and `{ genre: 'drama' }` pass; `'nope'`, `''` and `['drama','comedy']` fail.
- **`movie.service.spec.ts`:**
  - Exact `find` arguments, with and without `genre`.
  - The 404 message.
  - `update({})` makes no repository calls.
  - `update` returns the second `findOneBy` result.
  - `23505` and other DB errors become 500 without DB text in the message, and the log has no `query`/`parameters`.
  - `HttpException` passthrough.
- **`movie.controller.spec.ts`:**
  - `findOne`/`update`/`remove` use `@IdParam` with `ParseIdPipe`. Same approach as `user.controller.spec.ts:57-95`.
  - `ROLES_KEY = [Role.ADMIN]` on `create`/`update`/`remove` only.
  - `IS_PUBLIC_KEY` on `findAll`/`findOne` only.
  - Each method passes its exact arguments to the service.

### E2E (`npm run test:e2e`, `test/movie.e2e-spec.ts`)
- **Harness:** same as `test/auth-user.e2e-spec.ts:75-97`.
  - Prefix `e2e-movie-${Date.now()}-` on emails and titles, so it can't clash with the auth suite's cleanup.
  - Seed an admin via the `DataSource` (G9).
  - `afterAll` deletes the prefixed movies and users, then closes the app.
- **Public reads:**
  - `GET /movie` and `GET /movie/:id` without a token give 200.
  - `releaseDate` comes back exactly `YYYY-MM-DD`.
  - `posterUrl` is `null` when it was omitted.
- **Filter and order:** check against this run's own rows only.
  - `?genre=horror` includes this run's horror movie and excludes its comedy movie.
  - Title `…A` sorts before `…B`.
- **400 cases:**
  - Bad query: `?genre=nope`, a repeated genre, `?foo=1`.
  - Bad ids: `abc`, `0x10`, `0`, `2147483648`.
  - Invalid bodies: `id` in the body, `'120'` duration, `2021-02-29`, `http:` poster, a 201-character title, a NUL in the title. No row is created for any of these.
  - `PATCH` with `{}`, `{ title: null }` or an invalid genre.
- **404 cases:** `GET`, `PATCH` and `DELETE` on a deleted id; a second `DELETE`.
- **Auth:** `POST`, `PATCH` and `DELETE` give 401 without a token and 403 for a non-admin, and the DB row is unchanged.
- **Writes:**
  - `POST` gives 201 with trimmed strings.
  - Posting the same body twice gives two different ids.
  - `PATCH { durationMinutes: 150 }` changes only that field.
  - `PATCH { posterUrl: null }` clears it in the DB.
  - After `DELETE`, a `GET` gives 404.
- **Logging:** `spyOnAllLogging()` records nothing across a successful `POST` → `PATCH` → `DELETE`.

### Manual (`npm run start:dev`)
- **Setup:**
  - Register `admin@local.dev`.
  - Promote it with `docker exec postgres_db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE \"user\" SET \"isAdmin\"=true WHERE email='"'"'admin@local.dev'"'"'"'`.
  - Log in and keep the token as `$ADMIN`.
- **Checks:**
  - `POST /movie` as admin with `"title":"  Arrival "` gives 201, `"title":"Arrival"`, `"posterUrl":null`.
  - The same request without a token gives 401, and with a user token gives 403.
  - `GET /movie` without a token gives 200 and includes Arrival.
  - `?genre=sci-fi` gives 200, filtered; `?genre=western` gives 400.
  - `GET /movie/abc` gives 400, and `/movie/999999` gives 404.
  - `PATCH {"posterUrl":null}` gives 200 with null.
  - `PATCH {}` gives 400, and `{"releaseDate":"2021-02-29"}` gives 400.
  - `DELETE` gives 200, then `GET` gives 404.
  - `\d movie` in psql shows `varchar(200)`, `movie_genre_enum`, `date`, and a nullable `varchar(2048)`.
  - The server console shows no stack traces, bodies or tokens.

### Definition of done
- `npx eslint "{src,apps,libs,test}/**/*.ts"`, `npm test`, `npm run build` and `npm run test:e2e` pass. Node 24 per `.nvmrc`.
- No input listed above gives a 500.
- The greps:
  - `grep -rn "console\." src/movie src/common` is empty.
  - `NO_NUL = ` appears only in `src/common/string-validation.ts`.
- `git diff main -- src/user src/auth` shows only the import swap in `create-user.dto.ts`.
- The PR lists the out-of-scope items as follow-ups.
