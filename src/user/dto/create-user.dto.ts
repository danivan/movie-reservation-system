export class CreateUserDto {
  firstname: string;

  lastname: string;

  email: string;

  password: string;

  isAdmin: boolean = false;
}
