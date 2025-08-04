/**
 * Invoice Routes - Invoice Management API
 * 
 * Handles invoice creation, retrieval, and management
 */

const express = require('express');
const router = express.Router();
const invoiceService = require('../../services/invoice/invoiceService');
const logger = require('../../utils/logger');
const { db } = require('../../config/firebase');

/**
 * Get invoice by ID
 * GET /api/invoices/:invoiceId
 */
router.get('/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    logger.info(`Retrieving invoice: ${invoiceId}`);
    
    const result = await invoiceService.getInvoiceById(invoiceId);
    
    return res.status(200).json({
      success: true,
      invoice: result.invoice
    });
  } catch (error) {
    logger.error(`Error retrieving invoice ${req.params.invoiceId}:`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Invoice not found',
        invoiceId: req.params.invoiceId
      });
    }
    
    return res.status(500).json({
      error: 'Failed to retrieve invoice',
      details: error.message
    });
  }
});

/**
 * Get invoice by invoice number
 * GET /api/invoices/number/:invoiceNumber
 */
router.get('/number/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    
    logger.info(`Retrieving invoice by number: ${invoiceNumber}`);
    
    const result = await invoiceService.getInvoiceByNumber(invoiceNumber);
    
    return res.status(200).json({
      success: true,
      invoice: result.invoice
    });
  } catch (error) {
    logger.error(`Error retrieving invoice by number ${req.params.invoiceNumber}:`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Invoice not found',
        invoiceNumber: req.params.invoiceNumber
      });
    }
    
    return res.status(500).json({
      error: 'Failed to retrieve invoice',
      details: error.message
    });
  }
});

/**
 * Get invoices for a customer
 * GET /api/invoices/customer/:customerId
 */
router.get('/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { limit = 20, startAfter } = req.query;
    
    logger.info(`Retrieving invoices for customer: ${customerId}`);
    
    const result = await invoiceService.getCustomerInvoices(
      customerId, 
      parseInt(limit), 
      startAfter
    );
    
    return res.status(200).json({
      success: true,
      customerId,
      invoices: result.invoices,
      hasMore: result.hasMore,
      pagination: {
        limit: parseInt(limit),
        startAfter,
        lastDocument: result.lastDocument?.id || null
      }
    });
  } catch (error) {
    logger.error(`Error retrieving customer invoices for ${req.params.customerId}:`, error);
    return res.status(500).json({
      error: 'Failed to retrieve customer invoices',
      details: error.message
    });
  }
});

/**
 * Get invoices by order ID
 * GET /api/invoices/order/:orderId
 */
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    logger.info(`Retrieving invoices for order: ${orderId}`);
    
    const result = await invoiceService.getInvoicesByOrderId(orderId);
    
    return res.status(200).json({
      success: true,
      orderId,
      invoices: result.invoices
    });
  } catch (error) {
    logger.error(`Error retrieving invoices for order ${req.params.orderId}:`, error);
    return res.status(500).json({
      error: 'Failed to retrieve order invoices',
      details: error.message
    });
  }
});

/**
 * Search invoices
 * POST /api/invoices/search
 */
router.post('/search', async (req, res) => {
  try {
    const searchParams = req.body;
    
    logger.info('Searching invoices with parameters:', {
      customerEmail: searchParams.customerEmail ? 'provided' : 'not provided',
      invoiceNumber: searchParams.invoiceNumber || 'not provided',
      orderId: searchParams.orderId || 'not provided',
      status: searchParams.status || 'not provided'
    });
    
    const result = await invoiceService.searchInvoices(searchParams);
    
    return res.status(200).json({
      success: true,
      searchParams,
      invoices: result.invoices,
      count: result.count
    });
  } catch (error) {
    logger.error('Error searching invoices:', error);
    return res.status(500).json({
      error: 'Failed to search invoices',
      details: error.message
    });
  }
});

/**
 * Create manual invoice
 * POST /api/invoices/create
 */
router.post('/create', async (req, res) => {
  try {
    const { paymentData, orderData, customerInfo } = req.body;
    
    if (!paymentData || !orderData) {
      return res.status(400).json({
        error: 'paymentData and orderData are required'
      });
    }
    
    logger.info('Creating manual invoice', {
      orderId: orderData.orderId,
      amount: orderData.total,
      processor: paymentData.processor
    });
    
    const result = await invoiceService.createInvoice(paymentData, orderData, customerInfo);
    
    return res.status(201).json({
      success: true,
      invoice: result.invoice,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber
    });
  } catch (error) {
    logger.error('Error creating manual invoice:', error);
    return res.status(500).json({
      error: 'Failed to create invoice',
      details: error.message
    });
  }
});

/**
 * Update invoice status
 * PUT /api/invoices/:invoiceId/status
 */
router.put('/:invoiceId/status', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { status, metadata = {} } = req.body;
    
    if (!status) {
      return res.status(400).json({
        error: 'Status is required'
      });
    }
    
    const validStatuses = ['paid', 'pending', 'overdue', 'cancelled', 'refunded', 'disputed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    logger.info(`Updating invoice status: ${invoiceId} -> ${status}`);
    
    const result = await invoiceService.updateInvoiceStatus(invoiceId, status, metadata);
    
    return res.status(200).json({
      success: true,
      invoiceId: result.invoiceId,
      status: result.status
    });
  } catch (error) {
    logger.error(`Error updating invoice status for ${req.params.invoiceId}:`, error);
    return res.status(500).json({
      error: 'Failed to update invoice status',
      details: error.message
    });
  }
});

/**
 * Generate invoice PDF
 * GET /api/invoices/:invoiceId/pdf
 */
router.get('/:invoiceId/pdf', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    logger.info(`PDF generation requested for invoice: ${invoiceId}`);
    
    const result = await invoiceService.generateInvoicePDF(invoiceId);
    
    if (result.pdfUrl) {
      // For now, redirect to the PDF URL or return the URL
      return res.status(200).json({
        success: true,
        invoiceId,
        invoiceNumber: result.invoiceNumber,
        pdfUrl: result.pdfUrl,
        message: result.message
      });
    } else {
      return res.status(501).json({
        error: 'PDF generation not implemented',
        message: 'Please implement PDF generation using a library like puppeteer or jsPDF'
      });
    }
  } catch (error) {
    logger.error(`Error generating PDF for invoice ${req.params.invoiceId}:`, error);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      details: error.message
    });
  }
});

/**
 * Get invoice statistics
 * GET /api/invoices/stats/:period
 */
router.get('/stats/:period', async (req, res) => {
  try {
    const { period } = req.params;
    
    const validPeriods = ['week', 'month', 'year'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        error: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
      });
    }
    
    logger.info(`Retrieving invoice statistics for period: ${period}`);
    
    const result = await invoiceService.getInvoiceStats(period);
    
    return res.status(200).json({
      success: true,
      period: result.period,
      stats: result.stats
    });
  } catch (error) {
    logger.error(`Error retrieving invoice stats for period ${req.params.period}:`, error);
    return res.status(500).json({
      error: 'Failed to retrieve invoice statistics',
      details: error.message
    });
  }
});

/**
 * Export invoices to CSV
 * POST /api/invoices/export
 */
router.post('/export', async (req, res) => {
  try {
    const { searchParams = {}, format = 'json' } = req.body;
    
    logger.info('Exporting invoices', { format, searchParams });
    
    // Get invoices based on search parameters
    const result = await invoiceService.searchInvoices({
      ...searchParams,
      limit: 1000 // Limit for export
    });
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvData = convertInvoicesToCSV(result.invoices);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="invoices-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csvData);
    } else {
      // Return JSON
      return res.status(200).json({
        success: true,
        format,
        invoices: result.invoices,
        count: result.count,
        exportedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Error exporting invoices:', error);
    return res.status(500).json({
      error: 'Failed to export invoices',
      details: error.message
    });
  }
});

/**
 * Delete invoice (admin only)
 * DELETE /api/invoices/:invoiceId
 */
router.delete('/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { adminKey } = req.body;
    
    // Basic admin authentication (implement proper admin auth)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    logger.info(`Admin deletion requested for invoice: ${invoiceId}`);
    
    // Mark invoice as deleted instead of actually deleting
    await invoiceService.updateInvoiceStatus(invoiceId, 'cancelled', {
      deletedAt: new Date().toISOString(),
      deletedBy: 'admin',
      reason: 'admin_deletion'
    });
    
    return res.status(200).json({
      success: true,
      invoiceId,
      message: 'Invoice marked as cancelled'
    });
  } catch (error) {
    logger.error(`Error deleting invoice ${req.params.invoiceId}:`, error);
    return res.status(500).json({
      error: 'Failed to delete invoice',
      details: error.message
    });
  }
});

/**
 * Helper function to convert invoices to CSV
 */
function convertInvoicesToCSV(invoices) {
  if (!invoices || invoices.length === 0) {
    return 'No invoices found';
  }
  
  const headers = [
    'Invoice Number',
    'Invoice ID',
    'Order ID',
    'Customer Email',
    'Customer Name',
    'Status',
    'Total Amount',
    'Currency',
    'Issue Date',
    'Paid Date',
    'Payment Method',
    'Payment Processor'
  ];
  
  const rows = invoices.map(invoice => [
    invoice.invoiceNumber || '',
    invoice.id || '',
    invoice.order?.id || '',
    invoice.customer?.email || '',
    invoice.customer?.name || '',
    invoice.status || '',
    invoice.totalAmount || 0,
    invoice.currency || '',
    invoice.issueDate || '',
    invoice.paidDate || '',
    invoice.payment?.method || '',
    invoice.payment?.processor || ''
  ]);
  
  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
  
  return csvContent;
}

module.exports = router;