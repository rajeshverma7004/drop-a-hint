-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "referrerCustomerId" TEXT,
    "receiverName" TEXT NOT NULL,
    "receiverEmail" TEXT NOT NULL,
    "productUrl" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT,
    "token" TEXT,
    "rewardType" TEXT NOT NULL DEFAULT 'percentage',
    "rewardValue" TEXT NOT NULL DEFAULT '15',
    "discountCode" TEXT,
    "discountId" TEXT,
    "discountAmount" TEXT,
    "orderStatus" TEXT NOT NULL DEFAULT 'Pending',
    "rewardStatus" TEXT NOT NULL DEFAULT 'Not Rewarded',
    "orderId" TEXT,
    "referredOrderId" TEXT,
    "orderNumber" TEXT,
    "referredOrderNumber" TEXT,
    "referredCustomerId" TEXT,
    "referredCustomerEmail" TEXT,
    "orderAmount" TEXT,
    "paymentStatus" TEXT,
    "rewardIssued" BOOLEAN NOT NULL DEFAULT false,
    "rewardIssuedAt" DATETIME,
    "rewardEmailSent" BOOLEAN NOT NULL DEFAULT false,
    "rewardEmailSentAt" DATETIME,
    "purchaseDate" DATETIME,
    "expiryDate" DATETIME,
    "couponSent" BOOLEAN NOT NULL DEFAULT false,
    "minCartAmount" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "redeemedAt" DATETIME,
    "redeemingOrderId" TEXT,
    "redeemingOrderNumber" TEXT,
    "shopifyCustomerId" TEXT,
    "completedAt" DATETIME,
    "failureReason" TEXT,
    "rewardProcessingState" TEXT NOT NULL DEFAULT 'PENDING',
    "processingLockAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RewardIssuanceLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "referralId" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "discountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" TEXT NOT NULL DEFAULT '15',
    "expiryDays" INTEGER NOT NULL DEFAULT 30,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "minCartAmount" TEXT NOT NULL DEFAULT '0',
    "customMessage" TEXT,
    "senderEmail" TEXT,
    "emailSubject" TEXT,
    "confirmationSenderEmail" TEXT,
    "confirmationEmailSubject" TEXT
);

-- CreateTable
CREATE TABLE "ProductDiscountRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productImage" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_token_key" ON "Referral"("token");

-- CreateIndex
CREATE INDEX "Referral_shop_idx" ON "Referral"("shop");

-- CreateIndex
CREATE INDEX "Referral_token_idx" ON "Referral"("token");

-- CreateIndex
CREATE INDEX "Referral_orderId_idx" ON "Referral"("orderId");

-- CreateIndex
CREATE INDEX "Referral_referredOrderId_idx" ON "Referral"("referredOrderId");

-- CreateIndex
CREATE INDEX "Referral_senderEmail_idx" ON "Referral"("senderEmail");

-- CreateIndex
CREATE INDEX "Referral_receiverEmail_idx" ON "Referral"("receiverEmail");

-- CreateIndex
CREATE INDEX "Referral_orderStatus_idx" ON "Referral"("orderStatus");

-- CreateIndex
CREATE INDEX "Referral_rewardProcessingState_idx" ON "Referral"("rewardProcessingState");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_shop_topic_idx" ON "ProcessedWebhook"("shop", "topic");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_orderId_idx" ON "ProcessedWebhook"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardIssuanceLog_referralId_key" ON "RewardIssuanceLog"("referralId");

-- CreateIndex
CREATE INDEX "RewardIssuanceLog_shop_discountCode_idx" ON "RewardIssuanceLog"("shop", "discountCode");

-- CreateIndex
CREATE UNIQUE INDEX "RewardIssuanceLog_shop_referralId_key" ON "RewardIssuanceLog"("shop", "referralId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardIssuanceLog_shop_orderId_key" ON "RewardIssuanceLog"("shop", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDiscountRule_shop_shopifyProductId_key" ON "ProductDiscountRule"("shop", "shopifyProductId");
