import { Router } from "express";
import * as ctrl from "./auth_controllers.js";
import { requireAuth } from "./auth_middleware.js";

const r = Router();

r.post("/register", ctrl.register);
r.post("/login", ctrl.login);
r.post("/refresh", ctrl.refresh);
r.get("/profile", requireAuth, ctrl.profile);

export default r;
