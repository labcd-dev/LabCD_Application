import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { GoogleAnalytics } from './components/GoogleAnalytics'
import { UserThemeSync } from './components/UserThemeSync'
import { AdminLayout } from './components/admin/AdminLayout'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { PipelineProvider } from './context/PipelineContext'
import { ThemeProvider } from './context/ThemeContext'

// Core pages (loaded synchronously for instant startup)
import { LoginPage } from './pages/LoginPage'
import { LoginSsoPage } from './pages/LoginSsoPage'
import { RegisterPage } from './pages/RegisterPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { DesignPage } from './pages/DesignPage'
import { ProfilePage } from './pages/ProfilePage'
import { RecommenderPage } from './pages/RecommenderPage'
import { TrimmerPage } from './pages/TrimmerPage'

// Lazy-loaded heavy control studio pages
const MpcPage = lazy(() => import('./pages/MpcPage').then((m) => ({ default: m.MpcPage })))
const AdaptivePage = lazy(() => import('./pages/AdaptivePage').then((m) => ({ default: m.AdaptivePage })))
const MuloPage = lazy(() => import('./pages/MuloPage').then((m) => ({ default: m.MuloPage })))
const SiloPage = lazy(() => import('./pages/SiloPage').then((m) => ({ default: m.SiloPage })))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })))
const TutorialsPage = lazy(() => import('./pages/TutorialsPage').then((m) => ({ default: m.TutorialsPage })))
const BlogListPage = lazy(() => import('./pages/BlogListPage').then((m) => ({ default: m.BlogListPage })))
const BlogPostPage = lazy(() => import('./pages/BlogPostPage').then((m) => ({ default: m.BlogPostPage })))

// Lazy-loaded Admin pages (users never download admin code until visiting /admin)
const AdminOverviewPage = lazy(() => import('./pages/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })))
const AdminSitePage = lazy(() => import('./pages/AdminSitePage').then((m) => ({ default: m.AdminSitePage })))
const AdminBlogPage = lazy(() => import('./pages/AdminBlogPage').then((m) => ({ default: m.AdminBlogPage })))
const AdminBlogEditorPage = lazy(() => import('./pages/AdminBlogEditorPage').then((m) => ({ default: m.AdminBlogEditorPage })))
const AdminMonitoringPage = lazy(() => import('./pages/AdminMonitoringPage').then((m) => ({ default: m.AdminMonitoringPage })))
const AdminAnalyticsPage = lazy(() => import('./pages/AdminAnalyticsPage').then((m) => ({ default: m.AdminAnalyticsPage })))
const AdminErrorsPage = lazy(() => import('./pages/AdminErrorsPage').then((m) => ({ default: m.AdminErrorsPage })))
const AdminAuditLogPage = lazy(() => import('./pages/AdminAuditLogPage').then((m) => ({ default: m.AdminAuditLogPage })))
const AdminApiKeysPage = lazy(() => import('./pages/AdminApiKeysPage').then((m) => ({ default: m.AdminApiKeysPage })))
const AdminSsoPage = lazy(() => import('./pages/AdminSsoPage').then((m) => ({ default: m.AdminSsoPage })))
const AdminBugReportsPage = lazy(() => import('./pages/AdminBugReportsPage').then((m) => ({ default: m.AdminBugReportsPage })))
const AdminPlansPage = lazy(() => import('./pages/AdminPlansPage').then((m) => ({ default: m.AdminPlansPage })))
const AdminRolesPage = lazy(() => import('./pages/AdminRolesPage').then((m) => ({ default: m.AdminRolesPage })))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })))
const AdminUserDetailPage = lazy(() => import('./pages/AdminUserDetailPage').then((m) => ({ default: m.AdminUserDetailPage })))
const AdminProjectsPage = lazy(() => import('./pages/AdminProjectsPage').then((m) => ({ default: m.AdminProjectsPage })))
const AdminProjectDetailPage = lazy(() => import('./pages/AdminProjectDetailPage').then((m) => ({ default: m.AdminProjectDetailPage })))
const AdminPlantModelChatsPage = lazy(() => import('./pages/AdminPlantModelChatsPage').then((m) => ({ default: m.AdminPlantModelChatsPage })))
const AdminPlantModelChatDetailPage = lazy(() => import('./pages/AdminPlantModelChatDetailPage').then((m) => ({ default: m.AdminPlantModelChatDetailPage })))
const AdminSurveyPage = lazy(() => import('./pages/AdminSurveyPage').then((m) => ({ default: m.AdminSurveyPage })))
const AdminTutorialsPage = lazy(() => import('./pages/AdminTutorialsPage').then((m) => ({ default: m.AdminTutorialsPage })))

import './index.css'

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="size-7 animate-spin text-primary" />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <UserThemeSync />
        <PipelineProvider>
          <BrowserRouter>
            <GoogleAnalytics />
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/blog" element={<BlogListPage />} />
                <Route path="/blog/:slug" element={<BlogPostPage />} />
                <Route path="/" element={<Layout />}>
                  <Route index element={<LoginPage />} />
                  <Route path="login" element={<Navigate to="/" replace />} />
                  <Route path="login/sso" element={<LoginSsoPage />} />
                  <Route path="register" element={<RegisterPage />} />
                  <Route path="verify-email" element={<VerifyEmailPage />} />
                  <Route path="forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="reset-password" element={<ResetPasswordPage />} />
                  <Route element={<ProtectedRoute />}>
                    <Route path="design" element={<DesignPage />} />
                    <Route path="case-studies" element={<ProjectsPage defaultTab="cases" />} />
                    <Route path="studio" element={<Navigate to="/case-studies" replace />} />
                    <Route path="projects" element={<ProjectsPage defaultTab="history" />} />
                    <Route path="projects/:projectId" element={<ProjectDetailPage />} />
                    <Route path="recommender" element={<RecommenderPage />} />
                    <Route path="trimmer" element={<TrimmerPage />} />
                    <Route path="silo" element={<SiloPage />} />
                    <Route path="mulo" element={<MuloPage />} />
                    <Route path="adaptive" element={<AdaptivePage />} />
                    <Route path="mpc" element={<MpcPage />} />
                    <Route path="tutorials" element={<TutorialsPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="*" element={<Navigate to="/design" replace />} />
                  </Route>
                </Route>
                <Route element={<ProtectedRoute />}>
                  <Route path="admin" element={<AdminLayout />}>
                    <Route index element={<AdminOverviewPage />} />
                    <Route path="site" element={<AdminSitePage />} />
                    <Route path="blog" element={<AdminBlogPage />} />
                    <Route path="blog/:id" element={<AdminBlogEditorPage />} />
                    <Route path="monitoring" element={<AdminMonitoringPage />} />
                    <Route path="analytics" element={<AdminAnalyticsPage />} />
                    <Route path="errors" element={<AdminErrorsPage />} />
                    <Route path="audit-log" element={<AdminAuditLogPage />} />
                    <Route path="api-keys" element={<AdminApiKeysPage />} />
                    <Route path="sso" element={<AdminSsoPage />} />
                    <Route path="bug-reports" element={<AdminBugReportsPage />} />
                    <Route path="plans" element={<AdminPlansPage />} />
                    <Route path="roles" element={<AdminRolesPage />} />
                    <Route path="users" element={<AdminUsersPage />} />
                    <Route path="users/:userId" element={<AdminUserDetailPage />} />
                    <Route path="projects" element={<AdminProjectsPage />} />
                    <Route path="projects/:projectId" element={<AdminProjectDetailPage />} />
                    <Route path="plant-model" element={<AdminPlantModelChatsPage />} />
                    <Route
                      path="plant-model/:conversationId"
                      element={<AdminPlantModelChatDetailPage />}
                    />
                    <Route path="survey" element={<AdminSurveyPage />} />
                    <Route path="tutorials" element={<AdminTutorialsPage />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </PipelineProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
