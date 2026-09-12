import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { GoogleAnalytics } from './components/GoogleAnalytics'
import { UserThemeSync } from './components/UserThemeSync'
import { AdminLayout } from './components/admin/AdminLayout'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { PipelineProvider } from './context/PipelineContext'
import { ThemeProvider } from './context/ThemeContext'
import { AdminBlogEditorPage } from './pages/AdminBlogEditorPage'
import { AdminBlogPage } from './pages/AdminBlogPage'
import { AdminBugReportsPage } from './pages/AdminBugReportsPage'
import { AdminOverviewPage } from './pages/AdminOverviewPage'
import { AdminMonitoringPage } from './pages/AdminMonitoringPage'
import { AdminAnalyticsPage } from './pages/AdminAnalyticsPage'
import { AdminErrorsPage } from './pages/AdminErrorsPage'
import { AdminAuditLogPage } from './pages/AdminAuditLogPage'
import { AdminApiKeysPage } from './pages/AdminApiKeysPage'
import { AdminSsoPage } from './pages/AdminSsoPage'
import { AdminPlansPage } from './pages/AdminPlansPage'
import { AdminCreditsPage } from './pages/AdminCreditsPage'
import { AdminRolesPage } from './pages/AdminRolesPage'
import { AdminProjectDetailPage } from './pages/AdminProjectDetailPage'
import { AdminProjectsPage } from './pages/AdminProjectsPage'
import { AdminPlantModelChatDetailPage } from './pages/AdminPlantModelChatDetailPage'
import { AdminPlantModelChatsPage } from './pages/AdminPlantModelChatsPage'
import { AdminSitePage } from './pages/AdminSitePage'
import { AdminSurveyPage } from './pages/AdminSurveyPage'
import { AdminTutorialsPage } from './pages/AdminTutorialsPage'
import { AdminUserDetailPage } from './pages/AdminUserDetailPage'
import { AdminUserJourneyPage } from './pages/AdminUserJourneyPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { BlogListPage } from './pages/BlogListPage'
import { BlogPostPage } from './pages/BlogPostPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { DesignPage } from './pages/DesignPage'
import { LoginPage } from './pages/LoginPage'
import { LoginSsoPage } from './pages/LoginSsoPage'
import { ProfilePage } from './pages/ProfilePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { MuloPage } from './pages/MuloPage'
import { AdaptivePage } from './pages/AdaptivePage'
import { MpcPage } from './pages/MpcPage'
import { RecommenderPage } from './pages/RecommenderPage'
import { SiloPage } from './pages/SiloPage'
import { TrimmerPage } from './pages/TrimmerPage'
import { TutorialsPage } from './pages/TutorialsPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import './index.css'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <UserThemeSync />
        <PipelineProvider>
          <BrowserRouter>
            <GoogleAnalytics />
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
                  <Route path="credits" element={<AdminCreditsPage />} />
                  <Route path="roles" element={<AdminRolesPage />} />
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="users/:userId" element={<AdminUserDetailPage />} />
                  <Route path="journey" element={<AdminUserJourneyPage />} />
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
          </BrowserRouter>
        </PipelineProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
