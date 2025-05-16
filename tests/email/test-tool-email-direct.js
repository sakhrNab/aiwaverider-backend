/**
 * Direct test script for testing email functionality
 * This script doesn't depend on Firebase admin credentials
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

// Constants
const TEST_EMAIL = process.env.TEST_EMAIL || 'ai.waverider1@gmail.com';

// Log configuration
console.log('Email Configuration:');
console.log('SMTP Host:', process.env.EMAIL_HOST || 'smtp.zoho.com');
console.log('SMTP Port:', process.env.EMAIL_PORT || 465);
console.log('SMTP User:', process.env.EMAIL_USER || '<not set>');
console.log('SMTP Pass:', process.env.EMAIL_PASS ? '******' : '<not set>');
console.log('Test Email:', TEST_EMAIL);

/**
 * Create a Nodemailer transport
 */
function createTransport() {
  const transportOptions = {
    host: process.env.EMAIL_HOST || 'smtp.zoho.com',
    port: parseInt(process.env.EMAIL_PORT || '465', 10),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  };
  
  console.log('Creating transport with options:', {
    ...transportOptions,
    auth: {
      ...transportOptions.auth,
      pass: '******' // Hide password in logs
    }
  });
  
  return nodemailer.createTransport(transportOptions);
}

/**
 * Send a test email
 */
async function sendTestEmail() {
  try {
    const transport = createTransport();
    
    // Define email options
    const mailOptions = {
      from: {
        name: 'AI Waverider',
        address: process.env.EMAIL_USER
      },
      to: TEST_EMAIL,
      subject: 'Test Tool Update Email',
      text: 'This is a test of the tool update email functionality. If you receive this, the email sending is working!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
          <h1 style="color: #4a86e8;">Test Tool Update Email</h1>
          <p>This is a test of the tool update email functionality.</p>
          <p>If you receive this, the email sending is working!</p>
          <div style="margin-top: 30px; padding: 20px; background-color: #f5f5f5; border-radius: 5px;">
            <h3 style="color: #4a86e8;">Our Latest AI Tools</h3>
            <ul>
              <li style="margin-bottom: 10px;">
                <strong>AI Image Generator</strong> - Create stunning images with AI
              </li>
              <li style="margin-bottom: 10px;">
                <strong>Smart Summarizer</strong> - Get concise summaries of any text
              </li>
            </ul>
          </div>
          <div style="margin-top: 20px; text-align: center;">
            <a href="#" style="display: inline-block; padding: 10px 20px; background-color: #4a86e8; color: white; text-decoration: none; border-radius: 5px;">Explore All Tools</a>
          </div>
          <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
            This is a test email from AI Waverider.<br>
            &copy; 2025 AI Waverider
          </p>
        </div>
      `,
      // Add header fields for better deliverability
      headers: {
        'X-Priority': '3',
        'List-Unsubscribe': `<mailto:unsubscribe@${process.env.EMAIL_DOMAIN || 'aiwaverider.com'}?subject=unsubscribe>`,
        'X-Report-Abuse': `Please report abuse to support@${process.env.EMAIL_DOMAIN || 'aiwaverider.com'}`
      }
    };
    
    console.log('Sending test email to:', TEST_EMAIL);
    
    // Send mail
    const info = await transport.sendMail(mailOptions);
    
    console.log('Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    
    return info;
  } catch (error) {
    console.error('Error sending test email:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting direct email test...');
    await sendTestEmail();
    console.log('Email test completed successfully!');
  } catch (error) {
    console.error('Email test failed:', error);
    process.exit(1);
  }
}

// Run the main function
main(); 