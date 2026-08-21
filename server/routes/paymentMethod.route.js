import { Router } from "express";

import {
  createOne,
  getPaginated,
  updateOne,
  deleteOne,
} from "../controllers/paymentMethod.controller.js";

import {
  attachIconPath,
  uploadPaymentIcon,
} from "../middleware/paymentIconUpload.middleware.js";
import { verifyId } from "../middleware/validate.middleware.js";

const router = Router();

router.get("/", getPaginated);
router.post(
  "/",
  uploadPaymentIcon.single("icon"),
  attachIconPath,
  createOne,
);
router.patch(
  "/",
  verifyId,
  uploadPaymentIcon.single("icon"),
  attachIconPath,
  updateOne,
);
router.delete("/", verifyId, deleteOne);

export default router;
