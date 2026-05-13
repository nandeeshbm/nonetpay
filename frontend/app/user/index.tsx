import React, { useEffect } from "react";
import { router } from "expo-router";
import BrandedLoader from "../../components/BrandedLoader";

export default function UserHomeScreen() {
  // Redirect to wallet immediately
  useEffect(() => {
    router.replace('/user/wallet');
  }, []);

  return (
    <BrandedLoader label="Opening your wallet..." />
  );
}
