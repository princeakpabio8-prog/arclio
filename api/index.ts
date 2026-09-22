/**
 * Vercel Serverless Function — catch-all API handler
 *
 * Express apps are directly compatible with Vercel's serverless function
 * signature: (req, res) => void.  No wrapper library needed.
 *
 * Every request to /api/* and /health is handled by the Express routes
 * defined in packages/api/src/app.ts.
 *
 * Environment variables are set in the Vercel project dashboard —
 * never stored in source code.
 */

import { app } from "../packages/api/src/app.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as never, res as never);
}
