import { Notification } from "./models";
/** In-app delivery is always real; external delivery is reported separately. */
export async function notifyStudent(input: {
  userId: string;
  libraryId: string;
  title: string;
  message: string;
  phone?: string;
}) {
  const notification = await Notification.create({
    userId: input.userId,
    libraryId: input.libraryId,
    title: input.title,
    message: input.message,
  });
  const url = process.env.WHATSAPP_API_URL,
    token = process.env.WHATSAPP_API_TOKEN;
  if (!url || !token || !input.phone)
    return {
      notificationId: String(notification._id),
      inApp: true,
      whatsapp: "not-configured" as const,
    };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: input.phone, text: input.message }),
      signal: AbortSignal.timeout(10000),
    });
    return {
      notificationId: String(notification._id),
      inApp: true,
      whatsapp: response.ok ? "accepted-by-provider" : "failed",
    };
  } catch {
    return {
      notificationId: String(notification._id),
      inApp: true,
      whatsapp: "failed",
    };
  }
}
