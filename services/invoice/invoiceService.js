/**
 * Invoice Service - Invoice Creation and Management
 *
 * Handles invoice creation, storage, and retrieval for payments
 */

const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');

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
      const issueDate = new Date();
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

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

      // Prepare payment info
      const payment = {
        id: paymentData.id || paymentData.transaction_id,
        method: paymentData.paymentMethod || 'card',
        processor: paymentData.processor || 'unipay',
        transactionId: paymentData.transaction_id || paymentData.id,
        sessionId: paymentData.session_id || null,
        paidAt: issueDate.toISOString()
      };

      // Prepare metadata
      const metadata = {
        ...orderData.metadata,
        vatInfo: paymentData.vatInfo || null,
        originalAmount: paymentData.vatInfo?.originalAmount || subtotal
      };

      const orderId = orderData.orderId || orderData.id || null;

      // Save invoice to database
      await pool.query(
        `INSERT INTO invoices (
          id, invoice_number, status, issue_date, due_date, paid_date,
          paid_amount, total_amount, subtotal, vat_rate, vat_amount,
          currency, company, customer, line_items, payment,
          order_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          invoiceId, invoiceNumber, 'paid', issueDate, dueDate, issueDate,
          totalAmount, totalAmount, subtotal, vatRate, vatAmount,
          orderData.currency?.toUpperCase() || 'USD',
          JSON.stringify(this.companyInfo), JSON.stringify(customer),
          JSON.stringify(lineItems), JSON.stringify(payment),
          orderId, JSON.stringify(metadata)
        ]
      );

      // Update order with invoice ID
      if (orderId) {
        await pool.query(
          'UPDATE orders SET invoice_id = $1, invoice_number = $2 WHERE id = $3',
          [invoiceId, invoiceNumber, orderId]
        );
      }

      // Build invoice response object
      const invoice = {
        id: invoiceId,
        invoiceNumber,
        status: 'paid',
        issueDate: issueDate.toISOString(),
        dueDate: dueDate.toISOString(),
        paidDate: issueDate.toISOString(),
        company: this.companyInfo,
        customer,
        currency: orderData.currency?.toUpperCase() || 'USD',
        subtotal,
        vatRate,
        vatAmount,
        totalAmount,
        paidAmount: totalAmount,
        lineItems,
        payment,
        order: { id: orderId, createdAt: orderData.createdAt || issueDate.toISOString() },
        metadata,
        createdAt: issueDate.toISOString(),
        updatedAt: issueDate.toISOString()
      };

      logger.info(`Created invoice: ${invoiceNumber}`, {
        invoiceId,
        orderId,
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
      const { rows } = await pool.query(
        'SELECT * FROM invoices WHERE id = $1',
        [invoiceId]
      );

      if (rows.length === 0) {
        throw new Error(`Invoice not found: ${invoiceId}`);
      }

      return {
        success: true,
        invoice: this._mapRowToInvoice(rows[0])
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
      const { rows } = await pool.query(
        'SELECT * FROM invoices WHERE invoice_number = $1 LIMIT 1',
        [invoiceNumber]
      );

      if (rows.length === 0) {
        throw new Error(`Invoice not found: ${invoiceNumber}`);
      }

      return {
        success: true,
        invoice: this._mapRowToInvoice(rows[0])
      };
    } catch (error) {
      logger.error(`Error getting invoice by number ${invoiceNumber}:`, error);
      throw error;
    }
  }

  /**
   * Get invoices for a customer
   */
  async getCustomerInvoices(customerId, limit = 20, offset = 0) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM invoices
         WHERE customer->>'id' = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [customerId, limit, offset]
      );

      const invoices = rows.map(row => this._mapRowToInvoice(row));

      return {
        success: true,
        invoices,
        hasMore: rows.length === limit
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
      const { rows } = await pool.query(
        'SELECT * FROM invoices WHERE order_id = $1 ORDER BY created_at DESC',
        [orderId]
      );

      const invoices = rows.map(row => this._mapRowToInvoice(row));

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
      const setClauses = ['status = $1', 'updated_at = NOW()'];
      const values = [status];
      let paramIndex = 2;

      if (metadata.refundId) {
        setClauses.push(`metadata = jsonb_set(COALESCE(metadata, '{}'), '{refundId}', $${paramIndex}::jsonb)`);
        values.push(JSON.stringify(metadata.refundId));
        paramIndex++;
      }
      if (metadata.refundedAt) {
        setClauses.push(`metadata = jsonb_set(COALESCE(metadata, '{}'), '{refundedAt}', $${paramIndex}::jsonb)`);
        values.push(JSON.stringify(metadata.refundedAt));
        paramIndex++;
      }

      values.push(invoiceId);
      await pool.query(
        `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

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
   * Generate invoice PDF (placeholder)
   */
  async generateInvoicePDF(invoiceId) {
    try {
      const { invoice } = await this.getInvoiceById(invoiceId);

      logger.info(`PDF generation requested for invoice: ${invoice.invoiceNumber}`);

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

      const conditions = [];
      const values = [];
      let paramIndex = 1;

      if (customerEmail) {
        conditions.push(`customer->>'email' = $${paramIndex}`);
        values.push(customerEmail);
        paramIndex++;
      }

      if (invoiceNumber) {
        conditions.push(`invoice_number = $${paramIndex}`);
        values.push(invoiceNumber);
        paramIndex++;
      }

      if (orderId) {
        conditions.push(`order_id = $${paramIndex}`);
        values.push(orderId);
        paramIndex++;
      }

      if (status) {
        conditions.push(`status = $${paramIndex}`);
        values.push(status);
        paramIndex++;
      }

      if (startDate) {
        conditions.push(`created_at >= $${paramIndex}`);
        values.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        conditions.push(`created_at <= $${paramIndex}`);
        values.push(endDate);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(limit);

      const { rows } = await pool.query(
        `SELECT * FROM invoices ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex}`,
        values
      );

      const invoices = rows.map(row => this._mapRowToInvoice(row));

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

      const { rows } = await pool.query(
        `SELECT
           COUNT(*) as total_count,
           COALESCE(SUM(total_amount), 0) as total_revenue,
           COALESCE(AVG(total_amount), 0) as average_amount,
           currency,
           status
         FROM invoices
         WHERE created_at >= $1
         GROUP BY currency, status`,
        [startDate.toISOString()]
      );

      let totalRevenue = 0;
      let totalCount = 0;
      const currencyBreakdown = {};
      const statusBreakdown = { paid: 0, pending: 0, overdue: 0, cancelled: 0 };

      for (const row of rows) {
        const count = parseInt(row.total_count);
        const revenue = parseFloat(row.total_revenue);
        totalCount += count;
        totalRevenue += revenue;

        if (!currencyBreakdown[row.currency]) {
          currencyBreakdown[row.currency] = { count: 0, total: 0 };
        }
        currencyBreakdown[row.currency].count += count;
        currencyBreakdown[row.currency].total += revenue;

        if (statusBreakdown.hasOwnProperty(row.status)) {
          statusBreakdown[row.status] += count;
        }
      }

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

  /**
   * Map a database row to an invoice object
   */
  _mapRowToInvoice(row) {
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      status: row.status,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      paidDate: row.paid_date,
      paidAmount: parseFloat(row.paid_amount) || 0,
      totalAmount: parseFloat(row.total_amount) || 0,
      subtotal: parseFloat(row.subtotal) || 0,
      vatRate: parseFloat(row.vat_rate) || 0,
      vatAmount: parseFloat(row.vat_amount) || 0,
      currency: row.currency,
      company: row.company,
      customer: row.customer,
      lineItems: row.line_items,
      payment: row.payment,
      orderId: row.order_id,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = new InvoiceService();
