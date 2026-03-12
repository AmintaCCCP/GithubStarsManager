import React, { useState, useEffect } from 'react';
import { backend } from '../../services/backendAdapter';
import { useAppStore } from '../../store/useAppStore';
import { Trash2, UserPlus, Shield, User as UserIcon, AlertCircle, Loader2 } from 'lucide-react';

export const UserManagement: React.FC = () => {
  const { backendUser, language } = useAppStore();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('User');

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await backend.fetchUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (backendUser && backendUser.role === 'SuperAdmin') {
      fetchUsers();
    }
  }, [backendUser]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;

    try {
      setIsCreating(true);
      setError('');
      await backend.createUser({
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      setNewUsername('');
      setNewPassword('');
      setNewRole('User');
      await fetchUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!window.confirm(t('确定要删除此用户吗？', 'Are you sure you want to delete this user?'))) {
      return;
    }

    try {
      setError('');
      await backend.deleteUser(id);
      await fetchUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    }
  };

  if (backendUser?.role !== 'SuperAdmin') {
    return (
      <div className="p-8 text-center text-gray-500">
        {t('您没有权限访问此页面。', 'You do not have permission to access this page.')}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {t('用户管理', 'User Management')}
        </h1>
        <p className="text-gray-600">
          {t('管理您的系统用户，分配权限。', 'Manage system users and assign roles.')}
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5" />
            {t('创建新用户', 'Create New User')}
          </h2>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('用户名', 'Username')}
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('初始密码', 'Initial Password')}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('角色', 'Role')}
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="User">{t('普通用户 (User)', 'Standard User')}</option>
                <option value="SuperAdmin">{t('管理员 (SuperAdmin)', 'SuperAdmin')}</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isCreating || !newUsername || !newPassword}
              className="w-full md:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isCreating ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserPlus className="w-5 h-5" />}
              {t('创建用户', 'Create User')}
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-gray-500 flex flex-col items-center">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              {t('正在加载用户列表...', 'Loading users...')}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 font-medium text-gray-500 text-sm w-1/3">
                    {t('用户名', 'Username')}
                  </th>
                  <th className="px-6 py-4 font-medium text-gray-500 text-sm">
                    {t('角色', 'Role')}
                  </th>
                  <th className="px-6 py-4 font-medium text-gray-500 text-sm">
                    {t('创建时间', 'Created At')}
                  </th>
                  <th className="px-6 py-4 font-medium text-gray-500 text-sm text-right">
                    {t('操作', 'Actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900">{user.username}</span>
                        {user.id === backendUser?.id && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                            {t('当前', 'You')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        user.role === 'SuperAdmin' 
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {user.role === 'SuperAdmin' ? <Shield className="w-3.5 h-3.5" /> : <UserIcon className="w-3.5 h-3.5" />}
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(user.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {user.id !== backendUser?.id && (
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title={t('删除用户', 'Delete User')}
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                      {t('未找到用户', 'No users found')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
