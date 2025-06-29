import React, { useEffect, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { RepositoryList } from './components/RepositoryList';
import { CategorySidebar } from './components/CategorySidebar';
import { ReleaseTimeline } from './components/ReleaseTimeline';
import { SettingsPanel } from './components/SettingsPanel';
import { useAppStore } from './store/useAppStore';

function App() {
  const { 
    isAuthenticated, 
    currentView, 
    theme,
    searchResults,
    repositories 
  } = useAppStore();

  const [selectedCategory, setSelectedCategory] = useState('all');

  // Apply theme to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Main application interface
  const renderCurrentView = () => {
    switch (currentView) {
      case 'repositories':
        return (
          <div className="flex space-x-6">
            <CategorySidebar 
              repositories={repositories}
              selectedCategory={selectedCategory}
              onCategorySelect={setSelectedCategory}
            />
            <div className="flex-1 space-y-6">
              <SearchBar />
              <RepositoryList 
                repositories={searchResults.length > 0 ? searchResults : repositories}
                selectedCategory={selectedCategory}
              />
            </div>
          </div>
        );
      case 'releases':
        return <ReleaseTimeline />;
      case 'settings':
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderCurrentView()}
      </main>
    </div>
  );
}

export default App;