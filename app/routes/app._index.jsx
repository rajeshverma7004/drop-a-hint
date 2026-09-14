import { useState, useEffect, useCallback, useRef } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "react-router";
import prisma from "../db.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureWebhookSubscriptions } from "../services/webhooks.server";
import { reconcileReferralById, retryRewardEmail } from "../services/referral.server";
import dropAHintStyles from "../styles/drop-a-hint.css?url";

import { ReferralTable } from "../components/ReferralTable";
import { DiscountSettings } from "../components/DiscountSettings";
import { ProductDiscount } from "../components/ProductDiscount";
import { EmailSettings } from "../components/EmailSettings";
import { ProductDetailModal } from "../components/ProductDetailModal";
import { InstructionModal } from "../components/InstructionModal";
import { SupportModal } from "../components/SupportModal";
import { Toast, Text, Modal } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useSaveBar } from "../context/SaveBarContext";

export const meta = () => [{ title: "Drop A Hint" }];
export const links = () => [{ rel: "stylesheet", href: dropAHintStyles }];

export const loader = async ({ request }) => {
  let shop = "demo-shop.myshopify.com";
  let admin = null;
  try {
    const auth = await authenticate.admin(request);
    shop = auth.session.shop;
    admin = auth.admin;
  } catch (err) {
    if (err instanceof Response) {
      throw err;
    }
    // Standalone dev mode fallback
  }

  // Programmatically ensure required order webhooks are active in Shopify
  if (admin && shop) {
    try {
      await ensureWebhookSubscriptions({ shop, adminGraphql: admin.graphql });
    } catch (whErr) {
      console.warn("[App Loader] Webhook sync notice:", whErr.message);
    }
  }

  const referrals = await prisma.referral.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  const settings = await prisma.settings.findUnique({
    where: { shop },
  });

  const productDiscountRules = prisma.productDiscountRule
    ? await prisma.productDiscountRule.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return {
    referrals,
    settings: settings || {
      discountType: "percentage",
      discountValue: "15",
      customMessage: "",
      senderEmail: "",
      emailSubject: "",
      confirmationSenderEmail: "",
      confirmationEmailSubject: "",
    },
    productDiscountRules,
    shop,
  };
};

export const action = async ({ request }) => {
  let shop = "demo-shop.myshopify.com";
  let admin = null;
  try {
    const auth = await authenticate.admin(request);
    shop = auth.session.shop;
    admin = auth.admin;
  } catch (err) {
    if (err instanceof Response) {
      throw err;
    }
    // Standalone dev mode fallback
  }

  try {
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "save_settings") {
      const discountType = formData.get("discountType");
      const discountValue = formData.get("discountValue");
      const customMessage = formData.get("customMessage");

      await prisma.settings.upsert({
        where: { shop },
        update: { discountType, discountValue, customMessage },
        create: { shop, discountType, discountValue, customMessage },
      });
      return { success: true, message: "Settings saved successfully" };
    }

    if (intent === "save_email_settings") {
      const senderEmail = formData.get("senderEmail")?.toString().trim() || "";
      const emailSubject = formData.get("emailSubject")?.toString().trim() || "";
      const confirmationSenderEmail = formData.get("confirmationSenderEmail")?.toString().trim() || "";
      const confirmationEmailSubject = formData.get("confirmationEmailSubject")?.toString().trim() || "";

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (senderEmail && !emailRegex.test(senderEmail)) {
        return { success: false, error: "Please enter a valid sending email address for Product Referral Sent" };
      }
      if (confirmationSenderEmail && !emailRegex.test(confirmationSenderEmail)) {
        return { success: false, error: "Please enter a valid sending email address for Referral Purchase Confirmation" };
      }

      await prisma.settings.upsert({
        where: { shop },
        update: {
          senderEmail: senderEmail || null,
          emailSubject: emailSubject || null,
          confirmationSenderEmail: confirmationSenderEmail || null,
          confirmationEmailSubject: confirmationEmailSubject || null,
        },
        create: {
          shop,
          discountType: "percentage",
          discountValue: "15",
          senderEmail: senderEmail || null,
          emailSubject: emailSubject || null,
          confirmationSenderEmail: confirmationSenderEmail || null,
          confirmationEmailSubject: confirmationEmailSubject || null,
        },
      });

      const defaultSender = (process.env.SENDGRID_FROM_EMAIL || "rajesh.verma@galaxyweblinks.com").toLowerCase();
      const customSenders = [];
      if (senderEmail && senderEmail.toLowerCase() !== defaultSender) {
        customSenders.push(senderEmail);
      }
      if (confirmationSenderEmail && confirmationSenderEmail.toLowerCase() !== defaultSender && confirmationSenderEmail.toLowerCase() !== senderEmail.toLowerCase()) {
        customSenders.push(confirmationSenderEmail);
      }

      if (customSenders.length > 0) {
        return {
          success: true,
          message: `Email settings saved. Note: Custom sender '${customSenders.join(", ")}' must be verified in SendGrid as a Sender Identity to ensure delivery.`,
        };
      }

      return { success: true, message: "Email settings saved successfully" };
    }

    if (intent === "reconcile_referral") {
      const referralId = formData.get("referralId");
      const result = await reconcileReferralById({
        shop,
        referralId,
        adminGraphql: admin?.graphql,
      });
      return result;
    }

    if (intent === "retry_reward_email") {
      const referralId = formData.get("referralId");
      const result = await retryRewardEmail({
        shop,
        referralId,
      });
      return result;
    }

    if (intent === "sync_webhooks") {
      const result = await ensureWebhookSubscriptions({
        shop,
        adminGraphql: admin?.graphql,
      });
      return { success: true, message: "Shopify order webhooks synchronized successfully!", result };
    }

    return null;
  } catch (err) {
    console.error("[App Index Action Error]:", err);
    return { success: false, error: err.message || "An error occurred while saving settings." };
  }
};

export default function Index() {
  const { referrals: initialReferrals, settings, productDiscountRules } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { isDirty, triggerDiscard } = useSaveBar();
  const [activeTabIndex, setActiveTabIndex] = useState(0); // Default to tab 0 (Referral Status)
  const [pendingTabIndex, setPendingTabIndex] = useState(null);
  const [referrals, setReferrals] = useState(initialReferrals);

  const isReconciling = navigation.state === "submitting" && navigation.formData?.get("intent") === "reconcile_referral";
  const isRetryingEmail = navigation.state === "submitting" && navigation.formData?.get("intent") === "retry_reward_email";

  // Toast & Notification State
  const [toastMessage, setToastMessage] = useState(null);
  const lastToastRef = useRef({ msg: "", time: 0 });

  const showToast = useCallback((msg) => {
    if (!msg) return;
    const now = Date.now();
    // Suppress duplicate notifications with the same message within 1.5 seconds
    if (lastToastRef.current.msg === msg && now - lastToastRef.current.time < 1500) {
      return;
    }
    lastToastRef.current = { msg, time: now };
    setToastMessage(msg);
  }, []);

  // Modal State
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isInstructionOpen, setIsInstructionOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  useEffect(() => {
    setReferrals(initialReferrals);
  }, [initialReferrals]);

  useEffect(() => {
    if (actionData?.message) {
      showToast(actionData.message);
    } else if (actionData?.error) {
      showToast(actionData.error);
    }
    if (actionData?.referral) {
      setSelectedProduct(actionData.referral);
    }
  }, [actionData, showToast]);

  const toggleToastActive = () => setToastMessage(null);

  const handleTabClick = (newIndex) => {
    if (newIndex === activeTabIndex) return;
    if (isDirty) {
      setPendingTabIndex(newIndex);
    } else {
      setActiveTabIndex(newIndex);
    }
  };

  const handleConfirmTabChange = () => {
    if (pendingTabIndex !== null) {
      triggerDiscard();
      setActiveTabIndex(pendingTabIndex);
      setPendingTabIndex(null);
    }
  };

  const handleReconcileReferral = (referralId) => {
    submit({ intent: "reconcile_referral", referralId: String(referralId) }, { method: "post" });
  };

  const handleRetryRewardEmail = (referralId) => {
    submit({ intent: "retry_reward_email", referralId: String(referralId) }, { method: "post" });
  };

  const toastMarkup = toastMessage ? (
    <Toast content={toastMessage} onDismiss={toggleToastActive} />
  ) : null;

  return (
    <>
      <TitleBar title="Drop A Hint">
        <button onClick={() => setIsInstructionOpen(true)}>
          Installation Instructions
        </button>
        <button onClick={() => setIsSupportOpen(true)}>
          Support
        </button>
      </TitleBar>

      {/* Main Page Content Wrapper (34px margin, #F7F7F7 bg) */}
      <main className="dah-page-wrapper">
        <div className="dah-card-container">
          {/* Navigation Tabs (50px high, 3px teal underline) */}
          <div className="dah-tabs-bar" role="tablist" aria-label="Main Navigation">
            <button
              type="button"
              role="tab"
              id="tab-referral-status"
              aria-controls="panel-referral-status"
              aria-selected={activeTabIndex === 0}
              className={`dah-tab-item ${activeTabIndex === 0 ? "active" : ""}`}
              onClick={() => handleTabClick(0)}
            >
              REFERRAL STATUS
            </button>
            <button
              type="button"
              role="tab"
              id="tab-discount-settings"
              aria-controls="panel-discount-settings"
              aria-selected={activeTabIndex === 1}
              className={`dah-tab-item ${activeTabIndex === 1 ? "active" : ""}`}
              onClick={() => handleTabClick(1)}
            >
              DISCOUNT SETTINGS
            </button>
            <button
              type="button"
              role="tab"
              id="tab-product-discount"
              aria-controls="panel-product-discount"
              aria-selected={activeTabIndex === 2}
              className={`dah-tab-item ${activeTabIndex === 2 ? "active" : ""}`}
              onClick={() => handleTabClick(2)}
            >
              PRODUCT SPECIFIC DISCOUNT
            </button>
            <button
              type="button"
              role="tab"
              id="tab-email-settings"
              aria-controls="panel-email-settings"
              aria-selected={activeTabIndex === 3}
              className={`dah-tab-item ${activeTabIndex === 3 ? "active" : ""}`}
              onClick={() => handleTabClick(3)}
            >
              EMAIL SETTING
            </button>
          </div>

          {/* Tab Content Panels */}
          <div className="dah-tab-content-panel">
            {activeTabIndex === 0 && (
              <div
                id="panel-referral-status"
                role="tabpanel"
                aria-labelledby="tab-referral-status"
              >
                <ReferralTable referrals={referrals} />
              </div>
            )}

            {activeTabIndex === 1 && (
              <div
                id="panel-discount-settings"
                role="tabpanel"
                aria-labelledby="tab-discount-settings"
              >
                <DiscountSettings
                  initialSettings={settings}
                  onSave={(newSettings) => {
                    submit(
                      { intent: "save_settings", ...newSettings },
                      { method: "post" }
                    );
                  }}
                  showToast={showToast}
                />
              </div>
            )}

            {activeTabIndex === 2 && (
              <div
                id="panel-product-discount"
                role="tabpanel"
                aria-labelledby="tab-product-discount"
              >
                <ProductDiscount
                  initialRules={productDiscountRules}
                  showToast={showToast}
                />
              </div>
            )}

            {activeTabIndex === 3 && (
              <div
                id="panel-email-settings"
                role="tabpanel"
                aria-labelledby="tab-email-settings"
              >
                <EmailSettings
                  initialSettings={settings}
                  onSave={(newSettings) => {
                    submit(
                      { intent: "save_email_settings", ...newSettings },
                      { method: "post" }
                    );
                  }}
                  showToast={showToast}
                />
              </div>
            )}
          </div>
        </div>

        {/* Modals */}
        <ProductDetailModal
          item={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onReconcile={handleReconcileReferral}
          isReconciling={isReconciling}
          onRetryEmail={handleRetryRewardEmail}
          isRetryingEmail={isRetryingEmail}
        />

        <InstructionModal
          isOpen={isInstructionOpen}
          onClose={() => setIsInstructionOpen(false)}
        />

        <SupportModal
          isOpen={isSupportOpen}
          onClose={() => setIsSupportOpen(false)}
          showToast={showToast}
        />

        {/* Unsaved Changes Tab Switch Confirmation Modal */}
        <Modal
          open={pendingTabIndex !== null}
          onClose={() => setPendingTabIndex(null)}
          title="Unsaved changes"
          primaryAction={{
            content: "Leave tab",
            destructive: true,
            onAction: handleConfirmTabChange,
          }}
          secondaryActions={[
            {
              content: "Keep editing",
              onAction: () => setPendingTabIndex(null),
            },
          ]}
        >
          <Modal.Section>
            <Text as="p" variant="bodyMd">
              You have unsaved changes on this page. Leaving this tab will discard your changes. Are you sure you want to proceed?
            </Text>
          </Modal.Section>
        </Modal>
      </main>

      {toastMarkup}
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
