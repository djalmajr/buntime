import { z } from "zod";

export const signInCredentialsSchema = z.object({
  email: z.string().email({ message: "Por favor, insira um email válido." }),
  password: z.string().min(6, { message: "A senha deve ter pelo menos 6 caracteres." }),
});

export const signUpCredentialsSchema = signInCredentialsSchema.extend({
  name: z.string().min(2, { message: "O nome deve ter pelo menos 2 caracteres." }),
});

export type SignInCredentials = z.infer<typeof signInCredentialsSchema>;

export type SignUpCredentials = z.infer<typeof signUpCredentialsSchema>;
