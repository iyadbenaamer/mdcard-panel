import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import User from "../models/user.model.js";
import Setting from "../models/setting.model.js";

import { generateCode } from "../utils/generateCode.js";
import { handleError } from "../utils/errorHandler.js";
import { sendCode } from "../services/sendCode.js";

const MAX_CODE_ATTEMPTS = 20;
const RESEND_FIRST_TWO_DELAY_MS = 60 * 1000;
const RESEND_AFTER_DELAY_MS = 5 * 60 * 1000;
const RESEND_AFTER_FIVE_DELAY_MS = 2 * 60 * 60 * 1000;
const CODE_EXPIRATION = process.env.CODE_EXPIRATION || "1h";
const ACCESS_TOKEN_EXPIRATION = process.env.ACCESS_TOKEN_EXPIRATION || "14d";
const REMEMBER_ME_ACCESS_EXPIRATION =
  process.env.REMEMBER_ME_ACCESS_EXPIRATION || "90d";

const getNextResendAfter = (codesSentCount = 0) => {
  const nextCount = codesSentCount + 1;
  const delay =
    nextCount <= 2
      ? RESEND_FIRST_TWO_DELAY_MS
      : nextCount >= 5
        ? RESEND_AFTER_FIVE_DELAY_MS
        : RESEND_AFTER_DELAY_MS;
  return new Date(Date.now() + delay);
};

export const getMany = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const sortBy = req.query.sortBy === "status" ? "status" : "name";
    const sortOrder = req.query.sortOrder === "desc" ? -1 : 1;
    const sortField = sortBy === "status" ? "isActive" : "name";

    const total = await User.countDocuments();
    const users = await User.find()
      .select("name phone isActive createdAt")
      .sort({ [sortField]: sortOrder, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).json({
      users,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    return handleError(err, res);
  }
};

export const getOne = async (req, res) => {
  try {
    const { id } = req.query;

    const profile = await User.findById(id).select(
      "name phone balance isActive canBuy canSendCode verificationStatus createdAt updatedAt",
    );
    if (!profile) {
      return res.status(404).json({ code: "USER_NOT_FOUND" });
    }
    const support = await Setting.findOne({ key: "support" }).select("value");
    return res.status(200).json({ profile, support: support?.value || "" });
  } catch (err) {
    return handleError(err, res);
  }
};

export const create = async (req, res) => {
  try {
    let { name, phone, password } = req.body;
    name = name?.trim();
    phone = phone?.trim().toLowerCase();
    if (!(name && phone && password)) {
      return res.status(400).json({ code: "AUTH_REQUIRED_FIELDS_MISSING" });
    }
    const isPhoneUsed = (await User.findOne({ phone })) ? true : false;
    if (isPhoneUsed) {
      return res.status(409).json({ code: "AUTH_PHONE_ALREADY_REGISTERED" });
    }
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      phone,
      name,
      password: hashedPassword,
      isActive: false,
    });
    newUser.isActive = true;
    newUser.verificationStatus.isVerified = true;
    newUser.verificationStatus.token = null;
    newUser.verificationStatus.remainingAttempts = MAX_CODE_ATTEMPTS;
    newUser.verificationStatus.codesSentCount = 0;
    newUser.verificationStatus.resendAfter = getNextResendAfter(0);
    await newUser.save();

    return res.status(201).json({ code: "AUTH_USER_CREATED" });
  } catch (err) {
    return handleError(err, res);
  }
};

export const update = async (req, res) => {
  try {
    const { id } = req.query;
    let {
      phone,
      password,
      name,
      username,
      balance,
      verificationStatus,
      isActive,
      canBuy,
      canSendCode,
    } = req.body;

    if (!id) {
      return res.status(400).json({ code: "USER_ID_REQUIRED" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ code: "USER_NOT_FOUND" });
    }

    if (phone !== undefined) {
      phone = phone?.trim().toLowerCase();
      if (!phone) {
        return res.status(400).json({ code: "USER_PHONE_REQUIRED" });
      }
      if (await User.findOne({ phone, _id: { $ne: id } })) {
        return res.status(409).json({ code: "USER_PHONE_TAKEN" });
      }
      user.phone = phone;
    }

    if (username !== undefined) {
      username = username?.trim();
      if (!username) {
        return res.status(400).json({ code: "USER_USERNAME_REQUIRED" });
      }
      if (await User.findOne({ username, _id: { $ne: id } })) {
        return res.status(409).json({ code: "USER_USERNAME_TAKEN" });
      }
      user.username = username;
    }

    if (name !== undefined) {
      name = name?.trim();
      if (!name) {
        return res.status(400).json({ code: "USER_NAME_REQUIRED" });
      }
      user.name = name;
    }

    if (password) {
      const salt = await bcrypt.genSalt();
      user.password = await bcrypt.hash(password, salt);
    }

    if (balance !== undefined) {
      const parsedBalance = Number(balance);
      if (Number.isNaN(parsedBalance) || parsedBalance < 0) {
        return res.status(400).json({ code: "USER_BALANCE_INVALID" });
      }
      user.balance = parsedBalance;
    }

    if (verificationStatus?.isVerified !== undefined) {
      user.verificationStatus.isVerified =
        verificationStatus.isVerified === true;
    }

    if (typeof isActive === "boolean") {
      user.isActive = isActive;
    }

    if (typeof canBuy === "boolean") {
      user.canBuy = canBuy;
    }

    if (typeof canSendCode === "boolean") {
      user.canSendCode = canSendCode;
    }

    await user.save();
    return res.status(200).json(user);
  } catch (err) {
    return handleError(err, res);
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ code: "USER_ID_REQUIRED" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ code: "USER_NOT_FOUND" });
    }

    await user.deleteOne();
    return res.status(200).json({ code: "USER_DELETED" });
  } catch (err) {
    return handleError(err, res);
  }
};
