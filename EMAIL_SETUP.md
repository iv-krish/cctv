# Email Alert Setup Guide (SMTP)

This guide explains how to set up email alerts with snapshot pictures when motion or objects are detected.

---

### Recommended: Using Gmail with an App Password

If you have a Google / Gmail account, you can use Gmail's secure SMTP server for free.

1. **Enable 2-Step Verification**
   - Go to your Google Account: [myaccount.google.com](https://myaccount.google.com)
   - Go to **Security** and make sure **2-Step Verification** is turned ON.

2. **Generate an App Password**
   - Go to: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   - App name: Type `CCTV Alerts` and click **Create**.
   - Google will show you a 16-letter password (e.g., `abcd efgh ijkl mnop`). Copy this password.

3. **Update your `.env` file**
   Open `.env` in Notepad and set:
   ```env
   SMTP_ENABLED=true
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_16_letter_app_password
   SMTP_FROM=your_email@gmail.com
   SMTP_TO=destination_email@example.com
   ```

4. **Restart the Dashboard**
   - Double-click `stop-all.bat` and then `start-all.bat`.
   - The dashboard will now email you when detections happen.
