import { accessCookieValue, configuredPassword, COOKIE_NAME, hasMatchLabAccess } from "../../access";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ok:await hasMatchLabAccess()},{status:(await hasMatchLabAccess())?200:403});
}

export async function POST(request: Request) {
  const body = await request.json() as {password?:string};
  if (!configuredPassword() || body.password !== configuredPassword()) return Response.json({error:"密码不正确"},{status:403});
  const response = Response.json({ok:true});
  response.headers.append("Set-Cookie",`${COOKIE_NAME}=${await accessCookieValue()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`);
  return response;
}
