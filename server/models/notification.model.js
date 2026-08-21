import { Schema, model } from "mongoose";

// Mirrors mdcard/server/models/notification.model.js - both servers point
// at the same MongoDB database. This side is the only writer: the admin
// composes and sends these here; mdcard/server just reads them so the
// mobile app can show the user's notification feed.
const notificationSchema = new Schema(
  {
    title: { type: String, trim: true, default: "MD Card" },
    text: { type: String, required: true, trim: true },
    image: { type: String, default: "", trim: true },
    // Path the mobile app navigates to when the notification is pressed.
    link: { type: String, default: "", trim: true },
    audience: {
      type: String,
      enum: ["all", "authorized", "individual", "business", "unauthorized"],
      default: "all",
      required: true,
    },
  },
  { timestamps: true },
);

const Notification = model("Notification", notificationSchema, "notifications");
export default Notification;
