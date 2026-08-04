const { Ad, AdClick, User } = require("../db");

/**
 * Extract ad context from Facebook/Instagram referral parameters.
 * Facebook passes ad info via referral object in messenger events.
 * Example referral: { ref: "ad_12345", source: "ad", ad_id: "12345" }
 */
function extractAdContext(referralData) {
  if (!referralData) return null;
  
  const adId = referralData.ad_id || referralData.ref?.replace("ad_", "") || null;
  const source = referralData.source || null;
  
  if (!adId || source !== "ad") return null;
  
  return {
    adId,
    campaignId: referralData.campaign_id || null,
    campaignName: referralData.campaign_name || null,
    adSetName: referralData.adset_name || null,
    adName: referralData.ad_name || null,
    creative: {
      title: referralData.creative_title || null,
      body: referralData.creative_body || null,
      image_url: referralData.creative_image_url || null,
      call_to_action: referralData.cta || null
    },
    referralData
  };
}

/**
 * Track an ad click when a user comes from an ad.
 * Creates or updates the Ad record and logs the click.
 */
async function trackAdClick(uid, platform, adContext, firstMessage = "") {
  if (!adContext?.adId) return null;
  
  try {
    // Upsert Ad record
    const ad = await Ad.findOneAndUpdate(
      { adId: adContext.adId },
      {
        $setOnInsert: {
          campaignId: adContext.campaignId || "unknown",
          platform,
          startDate: new Date()
        },
        $set: {
          campaignName: adContext.campaignName || "",
          adSetName: adContext.adSetName || "",
          adName: adContext.adName || "",
          creative: adContext.creative || {},
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
    
    // Log the click
    const click = await AdClick.save({
      ad_id: adContext.adId,
      uid,
      platform,
      referral_data: adContext.referralData || {},
      first_message: firstMessage,
      conversation_started: true,
      clicked_at: new Date()
    });
    
    // Increment ad click count
    await Ad.updateOne(
      { adId: adContext.adId },
      { $inc: { totalClicks: 1, totalConversations: 1 } }
    );
    
    // Update user with ad context
    const existingUser = await User.findOne({ uid });
    const currentMetadata = (existingUser && existingUser.metadata) || {};
    await User.findOneAndUpdate(
      { uid },
      { $set: { metadata: { ...currentMetadata, adContext: { adId: adContext.adId, campaignName: adContext.campaignName } } } }
    );
    
    console.log(` [Ad Tracking] Click tracked: Ad ${adContext.adId} -> User ${uid}`);
    
    return { ad, click };
  } catch (err) {
    console.error(" [Ad Tracking] Error tracking click:", err.message);
    return null;
  }
}

/**
 * Mark an ad click as converted (order placed).
 */
async function markAdConversion(uid, orderId) {
  try {
    const user = await User.findOne({ uid });
    const adId = user?.metadata?.adContext?.adId;
    
    if (!adId) return false;
    
    // Update AdClick
    await AdClick.updateOne(
      { uid, adId },
      { $set: { orderPlaced: true, orderId } }
    );
    
    // Update Ad stats
    const order = require("../db").Order;
    const orderDoc = await order.findById(orderId);
    
    await Ad.updateOne(
      { adId },
      {
        $inc: {
          totalOrders: 1,
          totalRevenue: orderDoc?.totalAmount || 0
        }
      }
    );
    
    console.log(` [Ad Tracking] Conversion: Ad ${adId} -> Order ${orderId}`);
    return true;
  } catch (err) {
    console.error(" [Ad Tracking] Error marking conversion:", err.message);
    return false;
  }
}

/**
 * Get ad context for a user (for personalizing AI responses).
 */
async function getUserAdContext(uid) {
  try {
    const user = await User.findOne({ uid });
    const adId = user?.metadata?.adContext?.adId;
    
    if (!adId) return null;
    
    const ad = await Ad.findOne({ adId });
    if (!ad) return null;
    
    return {
      adId: ad.adId,
      campaignName: ad.campaignName,
      adName: ad.adName,
      creative: ad.creative,
      targeting: ad.targeting
    };
  } catch (err) {
    console.error(" [Ad Tracking] Error getting ad context:", err.message);
    return null;
  }
}

/**
 * Get performance metrics for all ads.
 */
async function getAdPerformance(days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const ads = await Ad.find({ status: { $in: ["active", "paused", "completed"] } })
      .sort({ totalClicks: -1 });
    
    const performance = await Promise.all(ads.map(async (ad) => {
      const clicks = await AdClick.countDocuments({ adId: ad.adId, clickedAt: { $gte: startDate } });
      const conversions = await AdClick.countDocuments({ adId: ad.adId, conversationStarted: true, clickedAt: { $gte: startDate } });
      const conversionRate = clicks > 0 ? ((conversions / clicks) * 100).toFixed(1) : 0;
      
      return {
        adId: ad.adId,
        campaignName: ad.campaignName,
        adName: ad.adName,
        platform: ad.platform,
        status: ad.status,
        clicks: ad.totalClicks,
        conversations: ad.totalConversations,
        orders: ad.totalOrders,
        revenue: ad.totalRevenue,
        conversionRate: parseFloat(conversionRate),
        costPerClick: ad.costPerClick,
        startDate: ad.startDate,
        endDate: ad.endDate
      };
    }));
    
    return performance;
  } catch (err) {
    console.error(" [Ad Tracking] Error getting performance:", err.message);
    return [];
  }
}

/**
 * Get recent ad clicks with user details.
 */
async function getRecentClicks(limit = 50) {
  try {
    const clicks = await AdClick.find()
      .sort({ clickedAt: -1 })
      .limit(limit)
      .lean();
    
    const uids = clicks.map(c => c.uid);
    const users = await User.find({ uid: { $in: uids } }).lean();
    const userMap = {};
    users.forEach(u => { userMap[u.uid] = u; });
    
    return clicks.map(click => ({
      ...click,
      user: userMap[click.uid] || null
    }));
  } catch (err) {
    console.error(" [Ad Tracking] Error getting recent clicks:", err.message);
    return [];
  }
}

module.exports = {
  extractAdContext,
  trackAdClick,
  markAdConversion,
  getUserAdContext,
  getAdPerformance,
  getRecentClicks
};
