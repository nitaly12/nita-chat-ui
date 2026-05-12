"use client";

import MyProfileFeed, { type MyProfileFeedProps } from "../profile/MyProfileFeed";

export type HomeFeedProps = MyProfileFeedProps;

/**
 * Center-column global feed (posts). Wrapped so `ChatApp` can swap this pane vs `ChatWindow`.
 */
export default function HomeFeed(props: HomeFeedProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
      <div className="mx-auto max-w-2xl pb-8">
        <MyProfileFeed {...props} />
      </div>
    </div>
  );
}
