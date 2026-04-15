import nodemailer from "nodemailer";

export const sendMail = async ({ to, bcc, subject, html, attachments }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"VITALIMES" <${process.env.EMAIL_USER}>`,
      to,
      bcc,
      subject,
      html,
      attachments, // ← Pass attachments here
    });

    console.log("Email sent successfully!");
  } catch (err) {
    console.error("Failed to send email:", err);
  }
};
