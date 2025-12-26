/**
 * Invoice Service - Invoice Creation and Management
 * 
 * Handles invoice creation, storage, and retrieval for payments
 */

const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');

// Initialize Firestore
const db = admin.firestore();

class InvoiceService {
  constructor() {
    this.companyInfo = {
      name: process.env.COMPANY_NAME || 'AI Waverider Ltd',
      address: process.env.COMPANY_ADDRESS || '123 Tech Street',
      city: process.env.COMPANY_CITY || 'Tbilisi',
      country: process.env.COMPANY_COUNTRY || 'Georgia',
      postalCode: process.env.COMPANY_POSTAL_CODE || '0108',
      taxId: process.env.COMPANY_TAX_ID || 'GE123456789',
      email: process.env.COMPANY_EMAIL || 'support@aiwaverider.com',
      phone: process.env.COMPANY_PHONE || '+995 558 950 430',
      website: process.env.COMPANY_WEBSITE || 'https://aiwaverider.com'
    };
  }

  /**
   * Generate unique invoice number
   */
  generateInvoiceNumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now().toString().slice(-6);
    return `INV-${year}${month}-${timestamp}`;
  }

  /**
   * Create invoice for payment
   */
  async createInvoice(paymentData, orderData, customerInfo = {}) {
    try {
      const invoiceId = uuidv4();
      const invoiceNumber = this.generateInvoiceNumber();
      const issueDate = new Date().toISOString();
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days from now

      // Calculate totals
      const subtotal = orderData.items?.reduce((sum, item) => {
        return sum + (item.price * (item.quantity || 1));
      }, 0) || orderData.total || 0;

      const vatAmount = paymentData.vatInfo?.vatAmount || 0;
      const vatRate = paymentData.vatInfo?.vatRate || 0;
      const totalAmount = subtotal + vatAmount;

      // Prepare customer information
      const customer = {
        id: customerInfo.userId || null,
        name: customerInfo.name || customerInfo.firstName || 'Valued Customer',
        email: customerInfo.email || paymentData.customer?.email || null,
        phone: customerInfo.phone || null,
        address: customerInfo.address || null,
        city: customerInfo.city || null,
        country: customerInfo.country || null,
        postalCode: customerInfo.postalCode || null,
        isRegistered: !!customerInfo.userId
      };

      // Prepare line items
      const lineItems = orderData.items?.map((item, index) => ({
        id: item.id || `item_${index + 1}`,
        description: item.title || item.name || item.description || 'AI Agent Template',
        quantity: item.quantity || 1,
        unitPrice: item.price || 0,
        totalPrice: (item.price || 0) * (item.quantity || 1),
        category: item.category || 'Digital Product',
        sku: item.sku || item.id || null
      })) || [{
        id: 'default_item',
        description: 'AI Agent Template Purchase',
        quantity: 1,
        unitPrice: subtotal,
        totalPrice: subtotal,
        category: 'Digital Product'
      }];

      // Create invoice object
      const invoice = {
        id: invoiceId,
        invoiceNumber,
        status: 'paid', // Since this is created after successful payment
        issueDate,
        dueDate,
        paidDate: issueDate,
        
        // Company information
        company: this.companyInfo,
        
        // Customer information
        customer,
        
        // Financial details
        currency: orderData.currency?.toUpperCase() || 'USD',
        subtotal,
        vatRate,
        vatAmount,
        totalAmount,
        paidAmount: totalAmount,
        
        // Line items
        lineItems,
        
        // Payment information
        payment: {
          id: paymentData.id || paymentData.transaction_id,
          method: paymentData.paymentMethod || 'card',
          processor: paymentData.processor || 'unipay',
          transactionId: paymentData.transaction_id || paymentData.id,
          sessionId: paymentData.session_id || null,
          paidAt: issueDate
        },
        
        // Order reference
        order: {
          id: orderData.orderId || orderData.id,
          createdAt: orderData.createdAt || issueDate
        },
        
        // Metadata
        metadata: {
          ...orderData.metadata,
          vatInfo: paymentData.vatInfo || null,
          originalAmount: paymentData.vatInfo?.originalAmount || subtotal
        },
        
        // Timestamps
        createdAt: issueDate,
        updatedAt: issueDate
      };

      // Save invoice to database
      await db.collection('invoices').doc(invoiceId).set(invoice);
      
      // Also save a reference in the order
      if (orderData.orderId || orderData.id) {
        const orderId = orderData.orderId || orderData.id;
        await db.collection('orders').doc(orderId).update({
          invoiceId,
          invoiceNumber,
          updatedAt: issueDate
        });
      }

      // If customer is registered, add invoice to their profile
      if (customer.id) {
        await db.collection('users').doc(customer.id).collection('invoices').doc(invoiceId).set({
          invoiceId,
          invoiceNumber,
          totalAmount,
          currency: invoice.currency,
          status: invoice.status,
          issueDate,
          paidDate: issueDate,
          orderId: orderData.orderId || orderData.id,
          createdAt: issueDate
        });
      }

      logger.info(`Created invoice: ${invoiceNumber}`, {
        invoiceId,
        orderId: orderData.orderId || orderData.id,
        totalAmount,
        currency: invoice.currency,
        customerId: customer.id,
        customerEmail: customer.email
      });

      return {
        success: true,
        invoice,
        invoiceId,
        invoiceNumber
      };
    } catch (error) {
      logger.error('Error creating invoice:', error);
      throw new Error(`Failed to create invoice: ${error.message}`);
    }
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(invoiceId) {
    try {
      const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
      
      if (!invoiceDoc.exists) {
        throw new Error(`Invoice not found: ${invoiceId}`);
      }

      return {
        success: true,
        invoice: invoiceDoc.data()
      };
    } catch (error) {
      logger.error(`Error getting invoice ${invoiceId}:`, error);
      throw error;
    }
  }

  /**
   * Get invoice by invoice number
   */
  async getInvoiceByNumber(invoiceNumber) {
    try {
      const invoicesSnapshot = await db.collection('invoices')
        .where('invoiceNumber', '==', invoiceNumber)
        .limit(1)
        .get();
      
      if (invoicesSnapshot.empty) {
        throw new Error(`Invoice not found: ${invoiceNumber}`);
      }

      const invoice = invoicesSnapshot.docs[0].data();
      
      return {
        success: true,
        invoice
      };
    } catch (error) {
      logger.error(`Error getting invoice by number ${invoiceNumber}:`, error);
      throw error;
    }
  }

  /**
   * Get invoices for a customer
   */
  async getCustomerInvoices(customerId, limit = 20, startAfter = null) {
    try {
      let query = db.collection('users').doc(customerId).collection('invoices')
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (startAfter) {
        query = query.startAfter(startAfter);
      }

      const invoicesSnapshot = await query.get();
      
      const invoices = [];
      invoicesSnapshot.forEach(doc => {
        invoices.push(doc.data());
      });

      return {
        success: true,
        invoices,
        hasMore: invoicesSnapshot.docs.length === limit,
        lastDocument: invoicesSnapshot.docs[invoicesSnapshot.docs.length - 1] || null
      };
    } catch (error) {
      logger.error(`Error getting customer invoices for ${customerId}:`, error);
      throw error;
    }
  }

  /**
   * Get invoices by order ID
   */
  async getInvoicesByOrderId(orderId) {
    try {
      const invoicesSnapshot = await db.collection('invoices')
        .where('order.id', '==', orderId)
        .orderBy('createdAt', 'desc')
        .get();
      
      const invoices = [];
      invoicesSnapshot.forEach(doc => {
        invoices.push(doc.data());
      });

      return {
        success: true,
        invoices
      };
    } catch (error) {
      logger.error(`Error getting invoices for order ${orderId}:`, error);
      throw error;
    }
  }

  /**
   * Update invoice status
   */
  async updateInvoiceStatus(invoiceId, status, metadata = {}) {
    try {
      const updateData = {
        status,
        updatedAt: new Date().toISOString(),
        ...metadata
      };

      await db.collection('invoices').doc(invoiceId).update(updateData);
      
      logger.info(`Updated invoice status: ${invoiceId} -> ${status}`);

      return {
        success: true,
        invoiceId,
        status
      };
    } catch (error) {
      logger.error(`Error updating invoice status for ${invoiceId}:`, error);
      throw error;
    }
  }

  /**
   * Generate invoice PDF (placeholder - you might want to use a PDF library)
   */
  async generateInvoicePDF(invoiceId) {
    try {
      const { invoice } = await this.getInvoiceById(invoiceId);
      
      // This is a placeholder - you would integrate with a PDF generation library
      // like puppeteer, jsPDF, or a service like Invoice Ninja
      
      logger.info(`PDF generation requested for invoice: ${invoice.invoiceNumber}`);
      
      // For now, return a download URL that points to a PDF generation endpoint
      const pdfUrl = `${process.env.API_URL || 'http://localhost:4000'}/api/invoices/${invoiceId}/pdf`;
      
      return {
        success: true,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        pdfUrl,
        message: 'PDF generation endpoint - implement with PDF library'
      };
    } catch (error) {
      logger.error(`Error generating PDF for invoice ${invoiceId}:`, error);
      throw error;
    }
  }

  /**
   * Search invoices
   */
  async searchInvoices(searchParams = {}) {
    try {
      const {
        customerEmail,
        invoiceNumber,
        orderId,
        status,
        startDate,
        endDate,
        limit = 20
      } = searchParams;

      let query = db.collection('invoices');

      // Apply filters
      if (customerEmail) {
        query = query.where('customer.email', '==', customerEmail);
      }
      
      if (invoiceNumber) {
        query = query.where('invoiceNumber', '==', invoiceNumber);
      }
      
      if (orderId) {
        query = query.where('order.id', '==', orderId);
      }
      
      if (status) {
        query = query.where('status', '==', status);
      }

      // Date range filtering (if needed, you might need composite indexes)
      if (startDate) {
        query = query.where('createdAt', '>=', startDate);
      }
      
      if (endDate) {
        query = query.where('createdAt', '<=', endDate);
      }

      query = query.orderBy('createdAt', 'desc').limit(limit);

      const invoicesSnapshot = await query.get();
      
      const invoices = [];
      invoicesSnapshot.forEach(doc => {
        invoices.push(doc.data());
      });

      return {
        success: true,
        invoices,
        count: invoices.length
      };
    } catch (error) {
      logger.error('Error searching invoices:', error);
      throw error;
    }
  }

  /**
   * Get invoice statistics
   */
  async getInvoiceStats(period = 'month') {
    try {
      const now = new Date();
      let startDate;

      switch (period) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const invoicesSnapshot = await db.collection('invoices')
        .where('createdAt', '>=', startDate.toISOString())
        .get();

      let totalRevenue = 0;
      let totalCount = 0;
      const currencyBreakdown = {};
      const statusBreakdown = { paid: 0, pending: 0, overdue: 0, cancelled: 0 };

      invoicesSnapshot.forEach(doc => {
        const invoice = doc.data();
        totalCount++;
        totalRevenue += invoice.totalAmount;
        
        // Currency breakdown
        if (!currencyBreakdown[invoice.currency]) {
          currencyBreakdown[invoice.currency] = { count: 0, total: 0 };
        }
        currencyBreakdown[invoice.currency].count++;
        currencyBreakdown[invoice.currency].total += invoice.totalAmount;
        
        // Status breakdown
        if (statusBreakdown.hasOwnProperty(invoice.status)) {
          statusBreakdown[invoice.status]++;
        }
      });

      return {
        success: true,
        period,
        stats: {
          totalRevenue,
          totalCount,
          averageAmount: totalCount > 0 ? totalRevenue / totalCount : 0,
          currencyBreakdown,
          statusBreakdown
        }
      };
    } catch (error) {
      logger.error(`Error getting invoice stats for period ${period}:`, error);
      throw error;
    }
  }
}

module.exports = new InvoiceService();