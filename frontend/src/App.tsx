import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { ChannelPage } from "./pages/ChannelPage";
import { WatchPage } from "./pages/WatchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ManualPage } from "./pages/ManualPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { PlaylistPage } from "./pages/PlaylistPage";
import { MusicPage } from "./pages/MusicPage";
import { MusicFavoritesPage } from "./pages/MusicFavoritesPage";
import { FolderPage } from "./pages/FolderPage";
import { StoragePage } from "./pages/StoragePage";
import { SharePage } from "./pages/SharePage";
import { SearchPage } from "./pages/SearchPage";
import { EventsPage } from "./pages/EventsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/"                  element={<HomePage />} />
        <Route path="/subscriptions"     element={<SubscriptionsPage />} />
        <Route path="/favorites"         element={<FavoritesPage />} />
        <Route path="/playlists"         element={<PlaylistsPage />} />
        <Route path="/playlist/:playlistId" element={<PlaylistPage />} />
        <Route path="/music"             element={<MusicPage />} />
        <Route path="/music/favorites"   element={<MusicFavoritesPage />} />
        <Route path="/storage"           element={<StoragePage />} />
        <Route path="/share"             element={<SharePage />} />
        <Route path="/manual"            element={<ManualPage />} />
        <Route path="/search"            element={<SearchPage />} />
        <Route path="/events"            element={<EventsPage />} />
        <Route path="/downloads"         element={<DownloadsPage />} />
        <Route path="/history"           element={<HistoryPage />} />
        <Route path="/channel/:channelId" element={<ChannelPage />} />
        <Route path="/folder/:folderId"   element={<FolderPage />} />
        <Route path="/watch/:videoId"    element={<WatchPage />} />
        <Route path="/settings"          element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
