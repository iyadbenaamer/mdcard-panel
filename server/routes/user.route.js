import { Router } from "express";

import {
  update,
  deleteUser,
  getOne,
  getMany,
  create,
} from "../controllers/user.controller.js";

import {
  getUserCustomPricing,
  createUserCustomPricing,
  deleteUserCustomPricing,
} from "../controllers/customPricing.controller.js";

import { verifyFields, verifyId } from "../middleware/validate.middleware.js";

const router = Router();

router.post("/", verifyFields, create);
router.get("/many", getMany);
router.get("/", getOne);
router.patch("/", verifyFields, update);
router.delete("/", deleteUser);

// Admin custom pricing
router.get("/custom-pricing", getUserCustomPricing);
router.post("/custom-pricing", createUserCustomPricing);
router.delete("/custom-pricing", deleteUserCustomPricing);

export default router;
