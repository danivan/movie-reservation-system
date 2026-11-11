# Security

src/movie/movie.controller.ts
line 34: findAll
Absence of rate limit, unthrottled public endpoints are vulnerable to automated scraping and accidental infinite loops from buggy clients.
I recommend use of @nestjs/throttler specifically to this endpoint.

# Patterns

# Edge cases

src/movie/movie.service.ts
line 27: create
No check for duplicate movie, movies with same titles are allowed but duplicate request should be blocked.

# Context

# Simplicity
