import nodemailer from 'nodemailer';

// Create a transporter using SMTP from environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 8000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async (options: SendEmailOptions): Promise<{ sent: boolean; reason?: string }> => {
  try {
    // If SMTP_USER is not configured, we just log and skip to prevent crashing in dev
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn('⚠️ SMTP credentials not found in .env. Skipping real email send.');
      return { sent:false, reason:'SMTP is not configured. No email was sent.' };
    }

    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'Peoples HR Technologies'}" <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    console.log(`📧 Email sent: ${info.messageId}`);
    return info.accepted?.length ? { sent:true } : { sent:false, reason:'The mail server did not accept the recipient.' };
  } catch (error) {
    const smtpError = error as { code?: string; responseCode?: number };
    console.error('❌ Error sending email:', error);
    if (smtpError.code === 'EAUTH' || smtpError.responseCode === 535) {
      return {
        sent: false,
        reason: 'SMTP authentication was rejected by the mail server. For Gmail, use a valid App Password in SMTP_PASS and try again.',
      };
    }
    return { sent:false, reason:'Email delivery failed. Check SMTP configuration before resending.' };
  }
};
