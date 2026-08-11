"use client";

import { createContext, useContext } from "react";

export type HomeTabsContextValue = {
  activeIndex: number;
  analyticsActivated: boolean;
};

const DEFAULT_CONTEXT: HomeTabsContextValue = {
  activeIndex: 0,
  analyticsActivated: false,
};

export const HomeTabsContext = createContext<HomeTabsContextValue>(DEFAULT_CONTEXT);

export function useHomeTabsContext(): HomeTabsContextValue {
  return useContext(HomeTabsContext);
}
