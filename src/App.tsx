import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { useEffect, useState, lazy, Suspense } from "react";
import { ThemeProvider } from "./contexts/ThemeContext";
import { BrowserTipModal } from "@/components/BrowserTipModal";

// 延迟加载工具页面，减少首页加载体积
const Home = lazy(() => import("@/pages/Home").then(m => ({ default: m.Home })));
const WatchFaceHome = lazy(() => import("@/pages/WatchFaceHome").then(m => ({ default: m.WatchFaceHome })));
const WatchFaceEdit = lazy(() => import("@/pages/WatchFaceEdit").then(m => ({ default: m.WatchFaceEdit })));
const WatchFaceEditShiYu = lazy(() => import("@/pages/WatchFaceEditShiYu").then(m => ({ default: m.WatchFaceEditShiYu })));
const WatchFaceEditLayerUI = lazy(() => import("@/pages/WatchFaceEditLayerUI").then(m => ({ default: m.WatchFaceEditLayerUI })));
const TemplateEditor = lazy(() => import("@/pages/TemplateEditor").then(m => ({ default: m.TemplateEditor })));
const Terms = lazy(() => import("@/pages/Terms").then(m => ({ default: m.Terms })));
const Resources = lazy(() => import("@/pages/Resources").then(m => ({ default: m.Resources })));
const ResourceDetail = lazy(() => import("@/pages/ResourceDetail").then(m => ({ default: m.ResourceDetail })));
const Admin = lazy(() => import("@/pages/Admin").then(m => ({ default: m.Admin })));
const Gallery = lazy(() => import("@/pages/Gallery").then(m => ({ default: m.Gallery })));
const FigmaLanding = lazy(() => import("@/pages/FigmaLanding").then(m => ({ default: m.FigmaLanding })));

function PageFallback({ light = false }: { light?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: light ? '#f9f9f9' : 'var(--bg-primary)',
        color: light ? '#3d3d3d' : 'var(--text-primary)',
      }}
    >
      加载中...
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitionStage, setTransitionStage] = useState<'enter' | 'exit'>('enter');

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname) {
      setTransitionStage('exit');
    }
  }, [location, displayLocation]);

  return (
    <div
      className={`page-transition ${transitionStage}`}
      onAnimationEnd={() => {
        if (transitionStage === 'exit') {
          setDisplayLocation(location);
          setTransitionStage('enter');
        }
      }}
    >
      <Routes location={displayLocation}>
        <Route path="/" element={
          <Suspense fallback={<PageFallback light />}>
            <FigmaLanding />
          </Suspense>
        } />
        {/* 兼容旧入口，统一跳到新官网 */}
        <Route path="/design/figma-home" element={<Navigate to="/" replace />} />
        <Route path="/tools/video-crop" element={
          <Suspense fallback={<PageFallback />}>
            <Home />
          </Suspense>
        } />
        <Route path="/tools/watch-face" element={
          <Suspense fallback={<PageFallback />}>
            <WatchFaceHome />
          </Suspense>
        } />
        <Route path="/tools/watch-face/edit" element={
          <Suspense fallback={<PageFallback />}>
            <WatchFaceEdit />
          </Suspense>
        } />
        <Route path="/tools/watch-face/edit-shiyu" element={
          <Suspense fallback={<PageFallback />}>
            <WatchFaceEditShiYu />
          </Suspense>
        } />
        <Route path="/tools/watch-face/edit-layerui" element={
          <Suspense fallback={<PageFallback />}>
            <WatchFaceEditLayerUI />
          </Suspense>
        } />
        <Route path="/tools/watch-face/edit-template/:id" element={
          <Suspense fallback={<PageFallback />}>
            <TemplateEditor />
          </Suspense>
        } />
        <Route path="/terms" element={
          <Suspense fallback={<PageFallback />}>
            <Terms />
          </Suspense>
        } />
        <Route path="/resources" element={
          <Suspense fallback={<PageFallback />}>
            <Resources />
          </Suspense>
        } />
        <Route path="/resources/:id" element={
          <Suspense fallback={<PageFallback />}>
            <ResourceDetail />
          </Suspense>
        } />
        <Route path="/resources/gallery" element={
          <Suspense fallback={<PageFallback />}>
            <Gallery />
          </Suspense>
        } />
        <Route path="/admin" element={
          <Suspense fallback={<PageFallback />}>
            <Admin />
          </Suspense>
        } />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <AnimatedRoutes />
      </Router>
      <BrowserTipModal />
    </ThemeProvider>
  );
}