import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, ILike } from 'typeorm';
import { AppModule } from './../src/app.module';
import { User } from './../src/user/entities/user.entity';
import { spyOnAllLogging } from './utils/spy-on-logging';

// Every user created by this suite gets an email with this prefix, so
// afterAll can remove exactly the rows this run created.
const RUN_PREFIX = `e2e-${Date.now()}-`;
const PASSWORD = 'password123';
let emailSeq = 0;
const uniqueEmail = () => `${RUN_PREFIX}${emailSeq++}@test.dev`;

const NUMERIC_ID_MESSAGE = 'Validation failed (numeric string is expected)';
const ID_RANGE_MESSAGE =
  'Validation failed (id must be between 1 and 2147483647)';
// One past the Postgres `integer` max.
const OUT_OF_RANGE_ID = '2147483648';
// Accepted by `+value` (16 and 1000) but not decimal, so rejected by G17.
const NON_DECIMAL_IDS = ['0x10', '1e3'];
// Postgres text/varchar rejects U+0000 (SQLSTATE 22021).
const NUL_NAME = 'a\u0000b';

describe('Auth & User (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const server = () => app.getHttpServer();

  const register = (body: Record<string, unknown>) =>
    request(server()).post('/auth/register').send(body);

  const login = (username: string, password: string) =>
    request(server()).post('/auth/login').send({ username, password });

  const authed = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  // Registers a fresh user and returns its DB row.
  const seedUser = async (email = uniqueEmail()): Promise<User> => {
    await register({
      firstname: 'Sam',
      lastname: 'Seeded',
      email,
      password: PASSWORD,
    }).expect(201);
    return dataSource.getRepository(User).findOneByOrFail({ email });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    // Register can't grant admin, so promote the seeded user directly in the DB.
    const adminEmail = uniqueEmail();
    await register({
      firstname: 'Admin',
      lastname: 'E2E',
      email: adminEmail,
      password: PASSWORD,
    }).expect(201);
    await dataSource
      .getRepository(User)
      .update({ email: adminEmail }, { isAdmin: true });

    const res = await login(adminEmail, PASSWORD).expect(201);
    adminToken = res.body.access_token;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource
        .getRepository(User)
        .delete({ email: ILike(`${RUN_PREFIX}%`) });
    }
    await app?.close();
  });

  describe('harness', () => {
    it('should seed an admin that can call an authenticated route', async () => {
      expect(adminToken).toEqual(expect.any(String));

      const res = await authed(
        request(server()).get('/user'),
        adminToken,
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /auth/register', () => {
    const makeRegisterBody = (overrides: Record<string, unknown> = {}) => ({
      firstname: 'Jane',
      lastname: 'Doe',
      email: uniqueEmail(),
      password: PASSWORD,
      ...overrides,
    });

    it('should reject isAdmin in the body with 400 and create no user', async () => {
      const email = uniqueEmail();

      const res = await register(
        makeRegisterBody({ email, isAdmin: true }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('isAdmin')]),
      );
      const row = await dataSource.getRepository(User).findOneBy({ email });
      expect(row).toBeNull();

      // Positive control: the same lookup must see a row once one exists.
      await register(makeRegisterBody({ email })).expect(201);
      const created = await dataSource.getRepository(User).findOneBy({ email });
      expect(created).not.toBeNull();
    });

    it('should reject an invalid email with 400', async () => {
      // Keeps the run prefix so cleanup still catches it if it is ever saved.
      const email = uniqueEmail().replace('@', '-at-');

      const res = await register(makeRegisterBody({ email })).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('email')]),
      );
    });

    it('should reject a password shorter than 8 characters with 400', async () => {
      const password = 'x'.repeat(7);

      const res = await register(makeRegisterBody({ password })).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('password')]),
      );
    });

    it('should reject a password of 73 characters with 400', async () => {
      const password = 'x'.repeat(73);

      const res = await register(makeRegisterBody({ password })).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('password')]),
      );
    });

    it('should reject a firstname containing a NUL byte with 400', async () => {
      const res = await register(
        makeRegisterBody({ firstname: NUL_NAME }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('firstname')]),
      );
    });

    it('should register a valid user with 201 as a non-admin', async () => {
      const email = uniqueEmail();

      const res = await register(makeRegisterBody({ email })).expect(201);

      expect(res.body.isAdmin).toBe(false);
      const row = await dataSource.getRepository(User).findOneBy({ email });
      expect(row?.isAdmin).toBe(false);
    });

    it('should store the email lowercased', async () => {
      const n = emailSeq++;
      const email = `${RUN_PREFIX}case-${n}@TEST.DEV`;
      const lowercased = `${RUN_PREFIX}case-${n}@test.dev`;

      const res = await register(makeRegisterBody({ email })).expect(201);

      expect(res.body.email).toBe(lowercased);
      const row = await dataSource
        .getRepository(User)
        .findOneBy({ email: lowercased });
      expect(row).not.toBeNull();
    });

    it('should not expose the password in the response body', async () => {
      const res = await register(makeRegisterBody()).expect(201);

      expect(res.body).not.toHaveProperty('password');
    });

    it('should return 409 for a duplicate email', async () => {
      const email = uniqueEmail();
      await register(makeRegisterBody({ email })).expect(201);
      const recased = email.replace('@test.dev', '@TEST.DEV');

      const res = await register(makeRegisterBody({ email: recased }));

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Email already in use');
      expect(JSON.stringify(res.body)).not.toContain(email);
      expect(JSON.stringify(res.body)).not.toContain(recased);
    });
  });

  describe('POST /user', () => {
    it('should store a bcrypt hash and let the created user log in', async () => {
      const email = uniqueEmail();

      const created = await authed(
        request(server()).post('/user').send({
          firstname: 'Carl',
          lastname: 'Created',
          email,
          password: PASSWORD,
        }),
        adminToken,
      ).expect(201);
      expect(created.body).not.toHaveProperty('password');

      const res = await login(email, PASSWORD).expect(201);
      expect(res.body.access_token).toEqual(expect.any(String));

      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ email });
      expect(row.password).toMatch(/^\$2[aby]\$/);
      expect(row.password).not.toBe(PASSWORD);
    });

    it('should return 409 for a duplicate email in a different case', async () => {
      const email = uniqueEmail();
      const recased = email.replace('@test.dev', '@TEST.DEV');
      const createUser = (address: string) =>
        authed(
          request(server()).post('/user').send({
            firstname: 'Dee',
            lastname: 'Duplicate',
            email: address,
            password: PASSWORD,
          }),
          adminToken,
        );
      await createUser(email).expect(201);

      const res = await createUser(recased).expect(409);

      expect(res.body.message).toBe('Email already in use');
      expect(JSON.stringify(res.body)).not.toContain(email);
      expect(JSON.stringify(res.body)).not.toContain(recased);
    });
  });

  describe('PATCH /user/:id', () => {
    const NEW_PASSWORD = 'new-password-123';

    const registerUser = async (email: string): Promise<User> => {
      await register({
        firstname: 'Pat',
        lastname: 'Patched',
        email,
        password: PASSWORD,
      }).expect(201);
      return dataSource.getRepository(User).findOneByOrFail({ email });
    };

    const patchUser = (id: number, body: Record<string, unknown>) =>
      authed(request(server()).patch(`/user/${id}`).send(body), adminToken);

    it('should hash a new password so the user can log in with it', async () => {
      const email = uniqueEmail();
      const before = await registerUser(email);

      await patchUser(before.id, { password: NEW_PASSWORD }).expect(200);

      const after = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: before.id });
      expect(after.password).toMatch(/^\$2[aby]\$/);
      expect(after.password).not.toBe(before.password);
      const res = await login(email, NEW_PASSWORD).expect(201);
      expect(res.body.access_token).toEqual(expect.any(String));
      await login(email, PASSWORD).expect(401);
    });

    it("should keep an admin's isAdmin when only the password is patched", async () => {
      const email = uniqueEmail();
      const user = await registerUser(email);
      await dataSource
        .getRepository(User)
        .update({ id: user.id }, { isAdmin: true });
      // Precondition: the user really is an admin before the PATCH.
      const promoted = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(promoted.isAdmin).toBe(true);

      await patchUser(user.id, { password: NEW_PASSWORD }).expect(200);

      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(row.isAdmin).toBe(true);
      await login(email, NEW_PASSWORD).expect(201);
    });

    it('should reject a null firstname with 400', async () => {
      const email = uniqueEmail();
      await register({
        firstname: 'Jane',
        lastname: 'Doe',
        email,
        password: PASSWORD,
      }).expect(201);
      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ email });

      const res = await authed(
        request(server()).patch(`/user/${user.id}`).send({ firstname: null }),
        adminToken,
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('firstname')]),
      );
      const row = await dataSource
        .getRepository(User)
        .findOneBy({ id: user.id });
      expect(row?.firstname).toBe('Jane');
    });

    it('should reject a lastname containing a NUL byte with 400', async () => {
      const user = await seedUser();

      const res = await patchUser(user.id, { lastname: NUL_NAME }).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('lastname')]),
      );
      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(row.lastname).toBe('Seeded');
    });

    it.each(NON_DECIMAL_IDS)(
      'should return 400 for the non-decimal id %p',
      async (id) => {
        const res = await authed(
          request(server()).patch(`/user/${id}`).send({ firstname: 'Hex' }),
          adminToken,
        ).expect(400);

        expect(res.body.message).toBe(NUMERIC_ID_MESSAGE);
      },
    );

    it('should return the updated user without password', async () => {
      const user = await seedUser();

      const res = await patchUser(user.id, { firstname: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.firstname).toBe('Renamed');
      expect(res.body.email).toBe(user.email);
      expect(res.body).not.toHaveProperty('password');
    });

    it('should return 409 when changing to an existing email', async () => {
      const taken = await seedUser();
      const user = await seedUser();
      const recased = taken.email.replace('@test.dev', '@TEST.DEV');

      const res = await patchUser(user.id, { email: recased }).expect(409);

      expect(res.body.message).toBe('Email already in use');
      expect(JSON.stringify(res.body)).not.toContain(taken.email);
      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(row.email).toBe(user.email);
    });

    it('should return 400 for an empty body', async () => {
      const user = await seedUser();

      const res = await patchUser(user.id, {}).expect(400);

      expect(res.body.message).toBe('No fields to update');
    });

    it('should return 404 for an unknown id', async () => {
      await patchUser(999999999, { firstname: 'Ghost' }).expect(404);
    });

    it('should return 400 for a non-numeric id', async () => {
      const res = await authed(
        request(server()).patch('/user/abc').send({ firstname: 'Abc' }),
        adminToken,
      ).expect(400);

      expect(res.body.message).toBe(NUMERIC_ID_MESSAGE);
    });

    it('should return 400 for an id above the Postgres integer max', async () => {
      const path = `/user/${OUT_OF_RANGE_ID}`;

      const res = await authed(
        request(server()).patch(path).send({ firstname: 'Big' }),
        adminToken,
      ).expect(400);

      expect(res.body.message).toBe(ID_RANGE_MESSAGE);
    });
  });

  describe('GET /user/:id', () => {
    it('should return 400 for a non-numeric id', async () => {
      const res = await authed(
        request(server()).get('/user/abc'),
        adminToken,
      ).expect(400);

      expect(res.body.message).toBe(NUMERIC_ID_MESSAGE);
    });

    it('should return 400 for an id above the Postgres integer max', async () => {
      const res = await authed(
        request(server()).get(`/user/${OUT_OF_RANGE_ID}`),
        adminToken,
      ).expect(400);

      expect(res.body.message).toBe(ID_RANGE_MESSAGE);
    });

    it.each(NON_DECIMAL_IDS)(
      'should return 400 for the non-decimal id %p',
      async (id) => {
        const res = await authed(
          request(server()).get(`/user/${id}`),
          adminToken,
        ).expect(400);

        expect(res.body.message).toBe(NUMERIC_ID_MESSAGE);
      },
    );

    it('should return 400 for id 0', async () => {
      const res = await authed(
        request(server()).get('/user/0'),
        adminToken,
      ).expect(400);

      expect(res.body.message).toBe(ID_RANGE_MESSAGE);
    });

    it('should return the user without password', async () => {
      const user = await seedUser();

      const res = await authed(
        request(server()).get(`/user/${user.id}`),
        adminToken,
      ).expect(200);

      expect(res.body.id).toBe(user.id);
      expect(res.body.email).toBe(user.email);
      expect(res.body).not.toHaveProperty('password');
    });
  });

  describe('DELETE /user/:id', () => {
    it('should return 400 for a non-numeric id', async () => {
      const req = request(server()).delete('/user/abc');

      const res = await authed(req, adminToken).expect(400);

      expect(res.body.message).toBe(NUMERIC_ID_MESSAGE);
    });

    it('should return 400 for an id above the Postgres integer max', async () => {
      const req = request(server()).delete(`/user/${OUT_OF_RANGE_ID}`);

      const res = await authed(req, adminToken).expect(400);

      expect(res.body.message).toBe(ID_RANGE_MESSAGE);
    });

    it.each(NON_DECIMAL_IDS)(
      'should return 400 for the non-decimal id %p',
      async (id) => {
        const req = request(server()).delete(`/user/${id}`);

        const res = await authed(req, adminToken).expect(400);

        expect(res.body.message).toBe(NUMERIC_ID_MESSAGE);
      },
    );

    it('should delete a user', async () => {
      const user = await seedUser();

      await authed(
        request(server()).delete(`/user/${user.id}`),
        adminToken,
      ).expect(200);

      const row = await dataSource
        .getRepository(User)
        .findOneBy({ id: user.id });
      expect(row).toBeNull();
    });
  });

  describe('POST /auth/login', () => {
    const registerUser = (email: string) =>
      register({
        firstname: 'Lou',
        lastname: 'Login',
        email,
        password: PASSWORD,
      }).expect(201);

    it('should reject an empty body with 401', async () => {
      await request(server()).post('/auth/login').send({}).expect(401);
    });

    it('should log in with correct credentials', async () => {
      const email = uniqueEmail();
      await registerUser(email);

      const res = await login(email, PASSWORD).expect(201);

      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('should return 401 for an unknown email', async () => {
      // Never registered.
      const email = uniqueEmail();

      await login(email, PASSWORD).expect(401);
    });

    it('should return the same response for an unknown email as for a wrong password', async () => {
      const email = uniqueEmail();
      await registerUser(email);

      const wrongPassword = await login(email, 'wrong-password-1');
      const unknownEmail = await login(uniqueEmail(), 'wrong-password-1');

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
      expect(unknownEmail.body).toEqual(wrongPassword.body);
    });

    it('should log in with a differently cased and padded email', async () => {
      const email = uniqueEmail();
      await registerUser(email);
      const recased = email
        .replace('e2e', 'E2E')
        .replace('@test.dev', '@TeSt.DeV');
      const typed = `  ${recased} `;

      const res = await login(typed, PASSWORD).expect(201);

      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('should return 401 for a non-string username', async () => {
      await request(server())
        .post('/auth/login')
        .send({ username: 123, password: 'whatever1' })
        .expect(401);
    });

    it('should return 401 for a username containing a NUL byte', async () => {
      const username = `${RUN_PREFIX}nul\u0000@test.dev`;

      const res = await request(server())
        .post('/auth/login')
        .send({ username, password: 'whatever1' })
        .expect(401);

      expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    });

    it('should return 401 for a non-string password', async () => {
      const email = uniqueEmail();
      await registerUser(email);

      await request(server())
        .post('/auth/login')
        .send({ username: email, password: 12345678 })
        .expect(401);
    });
  });

  describe('logging', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    // Successful authenticated requests make no legitimate log calls:
    // UserService's Logger.error only fires on DB failures.
    it('should not log on any console or Nest Logger channel while handling an authenticated admin request', async () => {
      // Seed outside the spy window; only the authenticated paths are under
      // test.
      const user = await seedUser();
      const logging = spyOnAllLogging();

      // GET /user passes through JwtStrategy.validate.
      await authed(request(server()).get('/user'), adminToken).expect(200);
      // PATCH /user/:id is @Roles(ADMIN), so it also passes through RolesGuard.
      await authed(
        request(server())
          .patch(`/user/${user.id}`)
          .send({ firstname: 'Quiet' }),
        adminToken,
      ).expect(200);

      logging.expectNoLogging();
    });
  });
});
