import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, Like } from 'typeorm';
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
        .delete({ email: Like(`${RUN_PREFIX}%`) });
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
});
