# WhatsApp Alert Setup Guide

This guide explains how to set up instant WhatsApp notifications when the AI detects people, vehicles, or animals on your CCTV cameras.

---

### How It Works
The dashboard uses the official, free **Meta WhatsApp Cloud API** to send alerts directly to your phone. No third-party subscription or paid service is needed for personal use.

---

### Step-by-Step Setup

1. **Create a Meta Developer Account**
   - Go to [developers.facebook.com](https://developers.facebook.com) and sign in with your Facebook account.
   - Click **My Apps** > **Create App**.
   - Select **Other** as the use case, then choose **Business**.
   - Name your app (for example: `Home CCTV Alerts`).

2. **Set Up WhatsApp Product**
   - On the App Dashboard, scroll to **WhatsApp** and click **Set up**.
   - Under the left sidebar, click **API Setup** (under WhatsApp).

3. **Get Your Credentials**
   - You will see:
     * **Phone number ID**: A number like `104857392819284`
     * **Temporary Access Token**: A long token string (for testing)
     * (Optional) Follow Meta's steps to create a Permanent System User Token for long-term use.
   - Add your personal phone number under **Step 5: To** to verify it for receiving test messages.

4. **Update your `.env` file**
   Open the `.env` file in Notepad and fill in these lines:
   ```env
   WHATSAPP_ENABLED=true
   WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
   WHATSAPP_ACCESS_TOKEN=your_access_token_here
   WHATSAPP_RECIPIENT_PHONE=your_phone_number_with_country_code
   ```
   *(Example: `WHATSAPP_RECIPIENT_PHONE=919876543210` without the `+` sign)*

5. **Restart the Dashboard**
   - Double-click `stop-all.bat` and then `start-all.bat`.
   - Your dashboard will now automatically send a WhatsApp alert whenever an AI event occurs!
