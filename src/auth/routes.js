import { Router } from "express";
import * as ctrl from "./controllers.js";
import { requireAuth } from "./middleware.js";

const r = Router();
r.post("/register", ctrl.register);
r.post("/login", ctrl.login);
r.post("/refresh", ctrl.refresh);
r.get("/profile", requireAuth, ctrl.profile);
export default r;
