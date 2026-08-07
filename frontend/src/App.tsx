import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { AdminErrorsPage } from './pages/AdminErrorsPage'
import { AdminAuditLogPage } from './pages/AdminAuditLogPage'
import { AdminPlansPage } from './pages/AdminPlansPage'
import { AdminRolesPage } from './pages/AdminRolesPage'
import { AdminProjectDetailPage } from './pages/AdminProjectDetailPage'
import { AdminProjectsPage } from './pages/AdminProjectsPage'
import { AdminSitePage } from './pages/AdminSitePage'
import { AdminSurveyPage } from './pages/AdminSurveyPage'
import { AdminUserDetailPage } from './pages/AdminUserDetailPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { BlogListPage } from './pages/BlogListPage'
import { BlogPostPage } from './pages/BlogPostPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { HomePage } from './pages/HomePage'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { ProfilePage } from './pages/ProfilePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { MuloPage } from './pages/MuloPage'
import { RecommenderPage } from './pages/RecommenderPage'
import { SiloPage } from './pages/SiloPage'
import { TrimmerPage } from './pages/TrimmerPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import './index.css'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <UserThemeSync />
        <PipelineProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/blog" element={<BlogListPage />} />
              <Route path="/blog/:slug" element={<BlogPostPage />} />
              <Route element={<Layout />}>
                <Route path="login" element={<LoginPage />} />
                <Route path="register" element={<RegisterPage />} />
                <Route path="verify-email" element={<VerifyEmailPage />} />
                <Route path="forgot-password" element={<ForgotPasswordPage />} />
                <Route path="reset-password" element={<ResetPasswordPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="studio" element={<HomePage />} />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route path="projects/:projectId" element={<ProjectDetailPage />} />
                  <Route path="recommender" element={<RecommenderPage />} />
                  <Route path="trimmer" element={<TrimmerPage />} />
                  <Route path="silo" element={<SiloPage />} />
                  <Route path="mulo" element={<MuloPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="*" element={<Navigate to="/studio" replace />} />
                </Route>
              </Route>
              <Route element={<ProtectedRoute />}>
                <Route path="admin" element={<AdminLayout />}>
                  <Route index element={<AdminOverviewPage />} />
                  <Route path="site" element={<AdminSitePage />} />
                  <Route path="blog" element={<AdminBlogPage />} />
                  <Route path="blog/:id" element={<AdminBlogEditorPage />} />
                  <Route path="monitoring" element={<AdminMonitoringPage />} />
                  <Route path="errors" element={<AdminErrorsPage />} />
                  <Route path="audit-log" element={<AdminAuditLogPage />} />
                  <Route path="bug-reports" element={<AdminBugReportsPage />} />
                  <Route path="plans" element={<AdminPlansPage />} />
                  <Route path="roles" element={<AdminRolesPage />} />
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="users/:userId" element={<AdminUserDetailPage />} />
                  <Route path="projects" element={<AdminProjectsPage />} />
                  <Route path="projects/:projectId" element={<AdminProjectDetailPage />} />
                  <Route path="survey" element={<AdminSurveyPage />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </PipelineProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
