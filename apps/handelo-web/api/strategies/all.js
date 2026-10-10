import handler from "../[...path].js";

// Non-Next.js Vercel routing needs explicit function entry points for nested paths.
// These wrappers keep every request behind the shared proxy's auth and validation.
export const config = { api: { bodyParser: false, responseLimit: false } };
export default handler;
