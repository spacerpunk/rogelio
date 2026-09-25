"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ClientLibrary } from "@/lib/library/data";
import { CharactersTab } from "./characters-tab";
import { LocationsTab } from "./locations-tab";
import { ReferencesTab } from "./references-tab";
import { TextsTab } from "./texts-tab";

const TABS = ["texts", "characters", "locations", "references"] as const;
type Tab = (typeof TABS)[number];

export function LibraryTabs({ library, initialTab }: { library: ClientLibrary; initialTab: string }) {
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "texts");

  function changeTab(value: string) {
    setTab(value as Tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  }

  const textCount = new Set(library.assets.filter((a) => a.textContent !== null).map((a) => a.lineageId)).size;
  const imageCount = library.assets.filter((a) => a.storagePath).length;

  return (
    <Tabs value={tab} onValueChange={changeTab} className="gap-0">
      <div className="border-b px-6 py-2">
        <TabsList>
          <TabsTrigger value="texts">Textos · {textCount}</TabsTrigger>
          <TabsTrigger value="characters">Personajes · {library.characters.length}</TabsTrigger>
          <TabsTrigger value="locations">Locaciones · {library.locations.length}</TabsTrigger>
          <TabsTrigger value="references">Referencias · {imageCount}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="texts">
        <TextsTab clientId={library.client.id} assets={library.assets} />
      </TabsContent>
      <TabsContent value="characters">
        <CharactersTab clientId={library.client.id} characters={library.characters} assets={library.assets} />
      </TabsContent>
      <TabsContent value="locations">
        <LocationsTab clientId={library.client.id} locations={library.locations} assets={library.assets} />
      </TabsContent>
      <TabsContent value="references">
        <ReferencesTab clientId={library.client.id} assets={library.assets} />
      </TabsContent>
    </Tabs>
  );
}
