import path from "path";

import PaymentMethod from "../models/paymentMethod.model.js";

import { safeDelete } from "../middleware/media.middleware.js";
import { handleError } from "../utils/errorHandler.js";
import parsePagination from "../utils/parsePagination.js";

const normalizeBoolean = (value) =>
  value === "true" ? true : value === "false" ? false : value;

const parseFields = (rawFields) => {
  if (rawFields === undefined) return undefined;
  if (Array.isArray(rawFields)) return rawFields;

  let parsed;
  try {
    parsed = JSON.parse(rawFields);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const normalized = [];
  for (const field of parsed) {
    const key = String(field?.key ?? "").trim();
    const label = String(field?.label ?? "").trim();
    if (!key || !label) return null;
    normalized.push({
      key,
      label,
      type: ["text", "phone", "number"].includes(field?.type)
        ? field.type
        : "text",
      required: field?.required !== false,
    });
  }
  return normalized;
};

export const getPaginated = async (req, res) => {
  try {
    const { active } = req.query;
    const isPaginated =
      req.query.page !== undefined && req.query.limit !== undefined;
    const { page, limit } = parsePagination(req.query.page, req.query.limit);

    const filter = {};
    if (active === "true") {
      filter.active = true;
    }
    if (active === "false") {
      filter.active = false;
    }

    let query = PaymentMethod.find(filter).sort({ createdAt: -1 });
    if (isPaginated) {
      query = query.skip((page - 1) * limit).limit(limit);
    }
    const paymentMethods = await query;
    const total = await PaymentMethod.countDocuments(filter);

    return res.status(200).json({ paymentMethods, total });
  } catch (err) {
    return handleError(err, res);
  }
};

export const createOne = async (req, res) => {
  try {
    let { name, label, minDeposit, maxDeposit, active } = req.body;
    const iconPath = req.iconPath;

    name = name?.trim();
    label = label?.trim();

    if (!name) {
      return res.status(400).json({ code: "PAYMENT_METHOD_NAME_REQUIRED" });
    }
    if (!label) {
      return res.status(400).json({ code: "PAYMENT_METHOD_LABEL_REQUIRED" });
    }
    if (!iconPath) {
      return res.status(400).json({ code: "PAYMENT_METHOD_ICON_REQUIRED" });
    }

    const parsedMin = Number(minDeposit);
    const parsedMax = Number(maxDeposit);
    if (!Number.isFinite(parsedMin) || parsedMin < 0) {
      return res
        .status(400)
        .json({ code: "PAYMENT_METHOD_MIN_DEPOSIT_INVALID" });
    }
    if (!Number.isFinite(parsedMax) || parsedMax <= parsedMin) {
      return res
        .status(400)
        .json({ code: "PAYMENT_METHOD_MAX_DEPOSIT_INVALID" });
    }

    const fields = parseFields(req.body.fields) ?? [];
    if (fields === null) {
      return res.status(400).json({ code: "PAYMENT_METHOD_FIELDS_INVALID" });
    }

    const existing = await PaymentMethod.findOne({ name });
    if (existing) {
      return res.status(400).json({ code: "PAYMENT_METHOD_NAME_TAKEN" });
    }

    const normalizedActive = normalizeBoolean(active);

    const paymentMethod = new PaymentMethod({
      name,
      label,
      iconPath,
      minDeposit: parsedMin,
      maxDeposit: parsedMax,
      fields,
      active: typeof normalizedActive === "boolean" ? normalizedActive : true,
    });

    await paymentMethod.save();
    return res.status(201).json(paymentMethod);
  } catch (err) {
    if (req.iconPath) {
      const newIconPath = path.join(process.env.UPLOAD_DIR, req.iconPath);
      await safeDelete(newIconPath);
    }
    return handleError(err, res);
  }
};

export const updateOne = async (req, res) => {
  try {
    const { id } = req.query;
    let { name, label, minDeposit, maxDeposit, active } = req.body;
    const iconPath = req.iconPath;

    const paymentMethod = await PaymentMethod.findById(id);
    if (!paymentMethod) {
      return res.status(404).json({ code: "PAYMENT_METHOD_NOT_FOUND" });
    }

    if (name !== undefined) {
      name = name.trim();
      if (!name) {
        return res.status(400).json({ code: "PAYMENT_METHOD_NAME_REQUIRED" });
      }
      if (name !== paymentMethod.name) {
        const existing = await PaymentMethod.findOne({ name });
        if (existing) {
          return res.status(400).json({ code: "PAYMENT_METHOD_NAME_TAKEN" });
        }
      }
      paymentMethod.name = name;
    }

    if (label !== undefined) {
      label = label.trim();
      if (!label) {
        return res
          .status(400)
          .json({ code: "PAYMENT_METHOD_LABEL_REQUIRED" });
      }
      paymentMethod.label = label;
    }

    if (minDeposit !== undefined) {
      const parsedMin = Number(minDeposit);
      if (!Number.isFinite(parsedMin) || parsedMin < 0) {
        return res
          .status(400)
          .json({ code: "PAYMENT_METHOD_MIN_DEPOSIT_INVALID" });
      }
      paymentMethod.minDeposit = parsedMin;
    }

    if (maxDeposit !== undefined) {
      const parsedMax = Number(maxDeposit);
      if (!Number.isFinite(parsedMax) || parsedMax <= paymentMethod.minDeposit) {
        return res
          .status(400)
          .json({ code: "PAYMENT_METHOD_MAX_DEPOSIT_INVALID" });
      }
      paymentMethod.maxDeposit = parsedMax;
    }

    if (req.body.fields !== undefined) {
      const fields = parseFields(req.body.fields);
      if (fields === null) {
        return res
          .status(400)
          .json({ code: "PAYMENT_METHOD_FIELDS_INVALID" });
      }
      paymentMethod.fields = fields;
    }

    if (iconPath !== undefined) {
      if (paymentMethod.iconPath && paymentMethod.iconPath !== iconPath) {
        const oldIconPath = path.join(
          process.env.UPLOAD_DIR,
          paymentMethod.iconPath,
        );
        await safeDelete(oldIconPath);
      }
      paymentMethod.iconPath = iconPath;
    }

    const normalizedActive = normalizeBoolean(active);
    if (typeof normalizedActive === "boolean") {
      paymentMethod.active = normalizedActive;
    }

    await paymentMethod.save();
    return res.status(200).json(paymentMethod);
  } catch (err) {
    if (req.iconPath) {
      const newIconPath = path.join(process.env.UPLOAD_DIR, req.iconPath);
      await safeDelete(newIconPath);
    }
    return handleError(err, res);
  }
};

export const deleteOne = async (req, res) => {
  try {
    const { id } = req.query;
    const paymentMethod = await PaymentMethod.findById(id);
    if (!paymentMethod) {
      return res.status(404).json({ code: "PAYMENT_METHOD_NOT_FOUND" });
    }

    if (paymentMethod.iconPath) {
      const iconPath = path.join(process.env.UPLOAD_DIR, paymentMethod.iconPath);
      await safeDelete(iconPath);
    }

    await paymentMethod.deleteOne();
    return res.status(200).json({ code: "PAYMENT_METHOD_DELETED" });
  } catch (err) {
    return handleError(err, res);
  }
};
