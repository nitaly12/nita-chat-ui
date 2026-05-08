export default function ChatSkeleton() {
  return (
    <div className="h-screen bg-gradient-to-br from-[#e8efe8] via-[#f2ede6] to-[#e3ecf5] p-0 sm:p-3">
      <div className="mx-auto flex h-full max-w-[1400px] overflow-hidden rounded-none border border-[#c7d5cb] bg-[#fbfaf6] shadow-sm sm:rounded-3xl">
        <aside className="hidden w-[340px] flex-col border-r border-[#d7e2d9] bg-[#f7f4ec] md:flex">
          <div className="animate-pulse space-y-4 p-5">
            <div className="h-7 w-28 rounded-lg bg-[#d8e0d8]" />
            <div className="h-10 w-full rounded-xl bg-[#e2e8de]" />
            <div className="space-y-3 pt-2">
              <div className="h-14 rounded-xl bg-[#e6ece3]" />
              <div className="h-14 rounded-xl bg-[#e6ece3]" />
              <div className="h-14 rounded-xl bg-[#e6ece3]" />
            </div>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-[#d7e2d9] bg-[#fcfbf7] p-5">
            <div className="animate-pulse flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-[#d8e0d8]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-36 rounded bg-[#d8e0d8]" />
                <div className="h-3 w-20 rounded bg-[#e2e8de]" />
              </div>
              <div className="h-9 w-9 rounded-xl bg-[#e2e8de]" />
            </div>
          </div>
          <section className="flex-1 space-y-4 overflow-hidden p-6">
            <div className="animate-pulse space-y-3">
              <div className="h-12 w-2/3 rounded-2xl bg-[#e2e8de]" />
              <div className="ml-auto h-12 w-1/2 rounded-2xl bg-[#d4e3d4]" />
              <div className="h-12 w-3/5 rounded-2xl bg-[#e2e8de]" />
              <div className="ml-auto h-12 w-2/5 rounded-2xl bg-[#d4e3d4]" />
            </div>
          </section>
          <div className="border-t border-[#d7e2d9] bg-[#fcfbf7] p-4">
            <div className="animate-pulse h-12 w-full rounded-2xl bg-[#e2e8de]" />
          </div>
        </main>
      </div>
    </div>
  );
}