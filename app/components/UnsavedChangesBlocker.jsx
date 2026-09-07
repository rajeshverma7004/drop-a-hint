import { useEffect, useCallback } from "react";
import { useBlocker } from "react-router";
import { Modal, Text } from "@shopify/polaris";
import { useSaveBar } from "../context/SaveBarContext";

export function UnsavedChangesBlocker() {
  const { isDirty } = useSaveBar();

  // Browser reload / tab close / window leave protection
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (isDirty) {
        event.preventDefault();
        event.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return event.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  // React Router internal route navigation protection
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        isDirty && currentLocation.pathname !== nextLocation.pathname,
      [isDirty]
    )
  );

  const isBlocked = blocker.state === "blocked";

  return (
    <Modal
      open={isBlocked}
      onClose={() => blocker.reset?.()}
      title="Unsaved changes"
      primaryAction={{
        content: "Leave page",
        destructive: true,
        onAction: () => blocker.proceed?.(),
      }}
      secondaryActions={[
        {
          content: "Keep editing",
          onAction: () => blocker.reset?.(),
        },
      ]}
    >
      <Modal.Section>
        <Text as="p" variant="bodyMd">
          You have unsaved changes on this page. Leaving this page will discard your changes. Are you sure you want to proceed?
        </Text>
      </Modal.Section>
    </Modal>
  );
}
