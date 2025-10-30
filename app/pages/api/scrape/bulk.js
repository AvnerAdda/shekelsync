import { getDB } from '../db.js';
import { decrypt } from '@/lib/server/encryption.js';
import { STALE_SYNC_THRESHOLD_MS } from '../../../utils/constants.js';

/**
 * Bulk Scrape API
 * POST /api/scrape/bulk
 * 
 * Identifies and scrapes all accounts that haven't been synced in 48+ hours
 * Executes scrapes in parallel for efficiency
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    // Calculate the threshold timestamp (48 hours ago)
    const thresholdDate = new Date(Date.now() - STALE_SYNC_THRESHOLD_MS);

    // Query to find accounts that need syncing
    const staleAccountsQuery = `
      SELECT 
        vc.id,
        vc.vendor,
        vc.nickname,
        vc.username,
        vc.password,
        vc.id_number,
        vc.card6_digits,
        vc.bank_account_number,
        vc.identification_code,
        COALESCE(last_scrapes.last_successful_scrape, vc.created_at) as last_update
      FROM vendor_credentials vc
      LEFT JOIN (
        SELECT 
          vendor,
          MAX(CASE WHEN status = 'success' THEN created_at ELSE NULL END) as last_successful_scrape
        FROM scrape_events
        GROUP BY vendor
      ) last_scrapes ON vc.vendor = last_scrapes.vendor
      WHERE COALESCE(last_scrapes.last_successful_scrape, vc.created_at) < $1
      ORDER BY last_update ASC
    `;

    const staleAccountsResult = await client.query(staleAccountsQuery, [thresholdDate]);
    const staleAccounts = staleAccountsResult.rows;

    if (staleAccounts.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'All accounts are up to date',
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        results: []
      });
    }

    console.log(`[Bulk Scrape] Found ${staleAccounts.length} accounts needing sync`);

    // Prepare scrape operations for each stale account
    const scrapePromises = staleAccounts.map(async (account) => {
      try {
        // Decrypt credentials
        const decryptedCredentials = {
          id: account.id_number ? decrypt(account.id_number) : null,
          card6Digits: account.card6_digits ? decrypt(account.card6_digits) : null,
          password: account.password ? decrypt(account.password) : null,
          username: account.username ? decrypt(account.username) : null,
          bankAccountNumber: account.bank_account_number || null,
          identification_code: account.identification_code ? decrypt(account.identification_code) : null,
          nickname: account.nickname
        };

        // Get last transaction date for this vendor to use as start date
        let startDate;
        try {
          const lastTxnResponse = await fetch(
            `http://localhost:${process.env.PORT || 3000}/api/accounts/last-transaction-date?vendor=${account.vendor}`,
            { headers: { 'Content-Type': 'application/json' } }
          );
          
          if (lastTxnResponse.ok) {
            const lastTxnData = await lastTxnResponse.json();
            startDate = new Date(lastTxnData.lastTransactionDate);
          } else {
            // Fallback: 30 days ago
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
          }
        } catch (error) {
          console.error(`Failed to get last transaction date for ${account.vendor}:`, error.message);
          // Fallback: 30 days ago
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);
        }

        // Prepare scrape configuration
        const scrapeConfig = {
          options: {
            companyId: account.vendor,
            startDate: startDate,
            combineInstallments: false,
            showBrowser: true,
            additionalTransactionInformation: true
          },
          credentials: decryptedCredentials
        };

        // Execute scrape
        console.log(`[Bulk Scrape] Starting scrape for ${account.vendor} (${account.nickname})`);
        const scrapeResponse = await fetch(
          `http://localhost:${process.env.PORT || 3000}/api/scrape`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scrapeConfig)
          }
        );

        const scrapeResult = await scrapeResponse.json();
        console.log(`[Bulk Scrape] ${account.vendor} response:`, {
          status: scrapeResponse.status,
          ok: scrapeResponse.ok,
          hasError: !!scrapeResult.error,
          hasAccounts: !!scrapeResult.accounts,
          message: scrapeResult.message
        });

        // Calculate transaction count from accounts data
        let transactionCount = 0;
        if (scrapeResponse.ok && scrapeResult.accounts) {
          transactionCount = scrapeResult.accounts.reduce((sum, acc) => {
            return sum + (acc.txns ? acc.txns.length : 0);
          }, 0);
        }

        return {
          vendor: account.vendor,
          nickname: account.nickname,
          success: scrapeResponse.ok && !scrapeResult.error,
          status: scrapeResponse.ok && !scrapeResult.error ? 'success' : 'failed',
          message: scrapeResult.message || (scrapeResponse.ok ? 'Scraped successfully' : 'Scrape failed'),
          transactionCount: transactionCount,
          error: scrapeResult.error || null
        };

      } catch (error) {
        console.error(`[Bulk Scrape] Error scraping ${account.vendor}:`, error);
        return {
          vendor: account.vendor,
          nickname: account.nickname,
          success: false,
          status: 'failed',
          message: error.message || 'Unknown error',
          transactionCount: 0
        };
      }
    });

    // Execute all scrapes in parallel
    console.log(`[Bulk Scrape] Starting parallel scraping of ${staleAccounts.length} accounts`);
    const results = await Promise.allSettled(scrapePromises);

    // Process results
    const processedResults = results.map(result => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          vendor: 'unknown',
          nickname: 'unknown',
          success: false,
          status: 'failed',
          message: result.reason?.message || 'Promise rejected',
          transactionCount: 0
        };
      }
    });

    const successCount = processedResults.filter(r => r.success).length;
    const failureCount = processedResults.length - successCount;
    const totalTransactions = processedResults.reduce((sum, r) => sum + (r.transactionCount || 0), 0);

    console.log(`[Bulk Scrape] Completed: ${successCount} successful, ${failureCount} failed, ${totalTransactions} total transactions`);
    console.log(`[Bulk Scrape] Detailed results:`, processedResults.map(r => ({
      vendor: r.vendor,
      success: r.success,
      status: r.status,
      transactions: r.transactionCount,
      error: r.error
    })));

    return res.status(200).json({
      success: true,
      message: `Bulk scrape completed: ${successCount}/${processedResults.length} accounts synced successfully`,
      totalProcessed: processedResults.length,
      successCount,
      failureCount,
      totalTransactions,
      results: processedResults
    });

  } catch (error) {
    console.error('[Bulk Scrape] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Bulk scrape failed',
      error: error.message
    });
  } finally {
    client.release();
  }
}

