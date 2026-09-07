-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Referral" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "receiverEmail" TEXT NOT NULL,
    "productUrl" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT,
    "token" TEXT,
    "discountCode" TEXT,
    "orderStatus" TEXT NOT NULL DEFAULT 'Pending',
    "rewardStatus" TEXT NOT NULL DEFAULT 'Not Rewarded',
    "orderId" TEXT,
    "orderNumber" TEXT,
    "discountAmount" TEXT,
    "purchaseDate" DATETIME,
    "expiryDate" DATETIME,
    "couponSent" BOOLEAN NOT NULL DEFAULT false,
    "minCartAmount" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "redeemedAt" DATETIME,
    "shopifyCustomerId" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Referral" ("createdAt", "id", "orderStatus", "productId", "productUrl", "receiverEmail", "receiverName", "senderEmail", "senderName", "shop") SELECT "createdAt", "id", "orderStatus", "productId", "productUrl", "receiverEmail", "receiverName", "senderEmail", "senderName", "shop" FROM "Referral";
DROP TABLE "Referral";
ALTER TABLE "new_Referral" RENAME TO "Referral";
CREATE UNIQUE INDEX "Referral_token_key" ON "Referral"("token");
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" TEXT NOT NULL DEFAULT '15',
    "expiryDays" INTEGER NOT NULL DEFAULT 30,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "minCartAmount" TEXT NOT NULL DEFAULT '0',
    "customMessage" TEXT
);
INSERT INTO "new_Settings" ("customMessage", "discountType", "discountValue", "id", "shop") SELECT "customMessage", "discountType", "discountValue", "id", "shop" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
