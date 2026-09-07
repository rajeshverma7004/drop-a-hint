/* global process */
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisProvider, Frame } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  if (process.env.SHOPIFY_API_SECRET) {
    try {
      await authenticate.admin(request);
    } catch {
      // Standalone dev mode
    }
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
];


import { SaveBarProvider } from "../context/SaveBarContext";
import { GlobalSaveBar } from "../components/GlobalSaveBar";
import { UnsavedChangesBlocker } from "../components/UnsavedChangesBlocker";

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <PolarisProvider i18n={enTranslations}>
      <AppProvider embedded={Boolean(apiKey && apiKey !== "dummy_api_key")} apiKey={apiKey || "dummy_api_key"}>
        <SaveBarProvider>
          <Frame>
            <s-app-nav>
              <s-link href="/app">Home</s-link>
            </s-app-nav>
            <GlobalSaveBar />
            <UnsavedChangesBlocker />
            <Outlet />
          </Frame>
        </SaveBarProvider>
      </AppProvider>
    </PolarisProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
