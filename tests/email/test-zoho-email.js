/**
 * Zoho SMTP Email Test
 * Tests email sending with Zoho SMTP settings
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// Load configuration from environment
const config = {
  host: process.env.SMTP_HOST || 'smtp.zoho.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE === 'true' || true,
  user: process.env.SMTP_USER || 'support@aiwaverider.com',
  password: process.env.SMTP_PASS,
  fromEmail: process.env.FROM_EMAIL || 'support@aiwaverider.com',
  fromName: process.env.FROM_NAME || 'AI Waverider'
};

// Display config (without showing password)
console.log('Email configuration:', {
  ...config,
  password: config.password ? '******' : '[NOT SET]'
});

// Create testing transport
function createTransport() {
  // Create transporter with Zoho SMTP settings
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    }
  });
  
  return transporter;
}

// Test function to send an email
async function testEmailSending(recipientEmail) {
  try {
    console.log(`\nSending test email to: ${recipientEmail}`);
    
    const transporter = createTransport();
    
    // Create test email
    const mailOptions = {
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: recipientEmail,
      subject: 'AI Waverider - Email Configuration Test With Zoho',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 5px;">
          <h1 style="color: #4a86e8; border-bottom: 2px solid #eee; padding-bottom: 10px;">Email Configuration Test</h1>
          
          <p>Hello,</p>
          
          <p>This is a test email to verify that your email configuration with Zoho SMTP is working correctly.</p>
          
          <p style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
            If you're receiving this email, it means your email service is properly configured with Zoho!
          </p>
          
          <div style="background-color: #e9f7ff; padding: 15px; border-radius: 5px; margin-top: 20px;">
            <h3 style="margin-top: 0; color: #4a86e8;">Email Details:</h3>
            <ul>
              <li><strong>Host:</strong> ${config.host}</li>
              <li><strong>Port:</strong> ${config.port}</li>
              <li><strong>Secure:</strong> ${config.secure}</li>
              <li><strong>From:</strong> ${config.fromName} &lt;${config.fromEmail}&gt;</li>
              <li><strong>Timestamp:</strong> ${new Date().toLocaleString()}</li>
            </ul>
          </div>
          
          <p style="margin-top: 30px;">This email includes proper email headers that should help with deliverability:</p>
          <ul>
            <li>DKIM-compatible formatting</li>
            <li>List-Unsubscribe header</li>
            <li>Sender verification</li>
          </ul>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="font-size: 12px; color: #777;">
            This is an automated message from AI Waverider.
            Please do not reply to this email.
          </p>
        </div>
      `,
      headers: {
        'List-Unsubscribe': '<https://aiwaverider.com/unsubscribe>',
        'Precedence': 'bulk',
        'X-AI-Wave-Rider': 'test-email',
      }
    };
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    
    console.log('\n✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
  } catch (error) {
    console.error('\n❌ Email sending failed:');
    console.error('Error message:', error.message);
    
    if (error.code === 'EAUTH') {
      console.error('\nAuthentication Error: Check your username and password for Zoho');
      console.error('Make sure you\'re using an app-specific password if 2FA is enabled');
    } else if (error.code === 'ESOCKET') {
      console.error('\nConnection Error: Unable to connect to the SMTP server');
      console.error('Check if the host and port are correct, and if there are any network issues');
    }
    
    throw error;
  }
}

// Run test with command line argument or default test email
const testEmail = process.argv[2] || 'ai.waverider1@gmail.com';

console.log('Starting email test with Zoho SMTP configuration...');
testEmailSending(testEmail)
  .then(() => {
    console.log('\n🎉 TEST COMPLETED: Email service is properly configured with Zoho SMTP');
    console.log('Check your inbox (and spam folder) for the test email');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }); 