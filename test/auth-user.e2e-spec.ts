import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, ILike } from 'typeorm';
import { AppModule } from './../src/app.module';
import { User } from './../src/user/entities/user.entity';

// Every user created by this suite gets an email with this prefix, so
// afterAll can remove exactly the rows this run created.
const RUN_PREFIX = `e2e-${Date.now()}-`;
const PASSWORD = 'password123';
let emailSeq = 0;
const uniqueEmail = () => `${RUN_PREFIX}${emailSeq++}@test.dev`;

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
  });

  describe('POST /user', () => {
    it('should store a bcrypt hash and let the created user log in', async () => {
      const email = uniqueEmail();

      await authed(
        request(server()).post('/user').send({
          firstname: 'Carl',
          lastname: 'Created',
          email,
          password: PASSWORD,
        }),
        adminToken,
      ).expect(201);

      const res = await login(email, PASSWORD).expect(201);
      expect(res.body.access_token).toEqual(expect.any(String));

      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ email });
      expect(row.password).toMatch(/^\$2[aby]\$/);
      expect(row.password).not.toBe(PASSWORD);
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
      const user = await registerUser(email);

      await patchUser(user.id, { password: NEW_PASSWORD }).expect(200);

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
  });

  describe('POST /auth/login', () => {
    it('should reject an empty body with 401', async () => {
      await request(server()).post('/auth/login').send({}).expect(401);
    });
  });
});
