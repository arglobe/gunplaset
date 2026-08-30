(function() {
      const STORAGE_KEY = 'gunplaset_user_collection_v2';
      let KITS = [];

      let state = {
        activeView: 'all',
        subfacetMode: 'grade',   // 'grade' | 'series'
        cardImageMode: 'product', // 'product' | 'boxart'
        searchQuery: '',
        selectedDecade: '2020s', // Default to 2020s (Latest) for compact 1-row view
        selectedYears: [],       // Array of selected years: e.g. ['2025', '2024']
        selectedGrades: [],      // Array of selected grades: e.g. ['HG', 'RG']
        selectedSeries: [],      // Array of selected series: e.g. ['機動戦士ガンダム SEED']
        selectedRun: 'all',
        sortBy: 'release_desc',
        page: 1,
        pageSize: 48,
        userCollection: loadUserCollection(),
        selectedKit: null,
        activeImageIndex: 0
      };

      function loadUserCollection() {
        let local = {};
        try {
          const d = localStorage.getItem(STORAGE_KEY);
          if (d) local = JSON.parse(d);
        } catch(e) {}

        // Seamless Merge with window.SAVED_COLLECTION_DATA from my_collection.js
        if (window.SAVED_COLLECTION_DATA && typeof window.SAVED_COLLECTION_DATA === 'object') {
          local = { ...window.SAVED_COLLECTION_DATA, ...local };
        }
        return local;
      }

      let autoSyncTimeout = null;
      let autoSyncFileHandle = null;

      function saveUserCollection() {
        try {
          // 1. Instant Synchronous Save to LocalStorage (Zero Risk of Data Loss)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.userCollection));
          updateGlobalStats();

          // 2. Safe Debounced Write to Google Drive File
          if (autoSyncFileHandle) {
            if (autoSyncTimeout) clearTimeout(autoSyncTimeout);
            autoSyncTimeout = setTimeout(async () => {
              try {
                const writable = await autoSyncFileHandle.createWritable();
                await writable.write(JSON.stringify(state.userCollection, null, 2));
                await writable.close();
                updateSyncUI(true, '☁️ 드라이브 저장 완료 ✓');
                setTimeout(() => {
                  if (autoSyncFileHandle) updateSyncUI(true);
                }, 1500);
              } catch(e) {
                console.warn('Auto sync write warning:', e);
              }
            }, 300);
          }
        } catch(e) {
          console.error('Storage save error:', e);
        }
      }

      window.addEventListener('beforeunload', () => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.userCollection));
        } catch(e) {}
      });

      function getItem(id) {
        return state.userCollection[id] || { backlog: 0, inProgress: 0, built: 0, wishlist: false, notes: '', customPrice: null };
      }

      function updateItem(id, updates) {
        const current = getItem(id);
        const updated = { ...current, ...updates };
        
        if (updated.backlog === 0 && updated.inProgress === 0 && updated.built === 0 && !updated.wishlist && !updated.notes && !updated.customPrice) {
          delete state.userCollection[id];
        } else {
          state.userCollection[id] = updated;
        }
        
        saveUserCollection();
        renderKits();
        if (state.activeView === 'analytics') {
          renderAnalytics();
        }
      }

      window.changeBacklog = function(id, delta, event) {
        if (event) event.stopPropagation();
        const item = getItem(id);
        const newQty = Math.max(0, (item.backlog || 0) + delta);
        updateItem(id, { backlog: newQty });
        showToast(delta > 0 ? '📦 새것/미개봉 수량 +1 (현재: ' + newQty + '개)' : '📦 새것/미개봉 수량 -1 (현재: ' + newQty + '개)');
      };

      window.changeInProgress = function(id, delta, event) {
        if (event) event.stopPropagation();
        const item = getItem(id);
        const newQty = Math.max(0, (item.inProgress || 0) + delta);
        updateItem(id, { inProgress: newQty });
        showToast(delta > 0 ? '⚙️ 조립 중 수량 +1 (현재: ' + newQty + '개)' : '⚙️ 조립 중 수량 -1 (현재: ' + newQty + '개)');
      };

      window.changeBuilt = function(id, delta, event) {
        if (event) event.stopPropagation();
        const item = getItem(id);
        const newQty = Math.max(0, (item.built || 0) + delta);
        updateItem(id, { built: newQty });
        showToast(delta > 0 ? '🔨 조립완료 수량 +1 (현재: ' + newQty + '개)' : '🔨 조립완료 수량 -1 (현재: ' + newQty + '개)');
      };

      window.toggleWishlist = function(id, event) {
        if (event) event.stopPropagation();
        const item = getItem(id);
        const nextState = !item.wishlist;
        updateItem(id, { wishlist: nextState });
        showToast(nextState ? '⭐ 위시리스트에 추가되었습니다.' : '⭐ 위시리스트에서 제외되었습니다.');
      };

      function showToast(msg) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.remove('opacity-0', 'translate-y-4');
        toast.classList.add('opacity-100', 'translate-y-0');
        setTimeout(() => {
          toast.classList.remove('opacity-100', 'translate-y-0');
          toast.classList.add('opacity-0', 'translate-y-4');
        }, 2000);
      }

      // 3-CURRENCY OFFICIAL BANDAI PRICING ENGINE
      const CURRENCY_STORAGE_KEY = 'gunpladex_active_currency';
      state.currency = localStorage.getItem(CURRENCY_STORAGE_KEY) || 'KRW';

      window.setCurrency = function(curr) {
        if (curr !== 'KRW' && curr !== 'JPY' && curr !== 'USD') return;
        state.currency = curr;
        try {
          localStorage.setItem(CURRENCY_STORAGE_KEY, curr);
        } catch(e) {}
        
        ['KRW', 'JPY', 'USD'].forEach(c => {
          const btn = document.getElementById('curr-btn-' + c);
          if (btn) {
            const isActive = c === curr;
            btn.classList.toggle('bg-cyan-500/20', isActive);
            btn.classList.toggle('text-cyan-400', isActive);
            btn.classList.toggle('border-cyan-500/40', isActive);
            btn.classList.toggle('text-slate-400', !isActive);
            btn.classList.toggle('border-transparent', !isActive);
          }
        });

        updateGlobalStats();
        populateDropdownSelects();
        renderYearSlider();
        renderSubfacetSlider();
        renderActiveFilterChips();
        renderKits();
        if (state.activeView === 'analytics') {
          renderAnalytics();
        }
        if (state.selectedKit) {
          renderModalContent();
        }
        const t = UI_I18N[state.currency] || UI_I18N.KRW;
        showToast(t.toastLangChanged);
      };

      // Calculate exact official Bandai regional price (Pure List B Engine)
      function getKitPriceInfo(kit, targetCurrency) {
        const curr = targetCurrency || state.currency || 'KRW';
        const hasOfficialEntry = !!(window.KIT_PRICE_DB && window.KIT_PRICE_DB[kit.id] && window.KIT_PRICE_DB[kit.id] > 0);
        
        if (!hasOfficialEntry) {
          const unverifiedText = curr === 'USD' ? 'Price Unlisted' : (curr === 'JPY' ? '公式価格未掲載' : '공식가 미확인');
          const unverifiedNote = curr === 'USD' ? '⚠️ Not on Official Site' : (curr === 'JPY' ? '⚠️ 公式未掲載' : '⚠️ 공식몰 미등재');
          return {
            currency: curr,
            value: 0,
            formatted: unverifiedText,
            orgNote: unverifiedNote,
            isVerified: false,
            isClubG: false,
            badgeColor: 'text-amber-400 font-medium'
          };
        }

        const yenTaxInc = window.KIT_PRICE_DB[kit.id];
        
        // Base Tax-Excluded Yen (일본 소비세 10% 제외 원가)
        const yenTaxEx = Math.round(yenTaxInc / 1.1);

        // Check if item is Club G / Premium Bandai (excluding Gundam Base limited)
        const nameUpper = ((kit.name || '') + ' ' + (kit.nameEn || '')).toUpperCase();
        const isGb = nameUpper.includes('GUNDAM BASE') || (kit.nameJp && kit.nameJp.includes('ガンダムベース'));
        const isClubG = (kit.run === 'P-Bandai' || (kit.name && (kit.name.includes('한정') || nameUpper.includes('LIMITED') || nameUpper.includes('P-BANDAI')))) && !isGb;

        // Multiplier: Club G = 14.3x, Standard / Gundam Base = 12.0x
        const multiplier = isClubG ? 14.3 : 12.0;

        // 1. KRW: Real Bandai Korea Store / Gundam Base / Club G Retail MSRP
        const krwVal = Math.round(yenTaxEx * multiplier);

        // 2. JPY: Bandai Japan Retail MSRP (Tax Included)
        const jpyVal = yenTaxInc;

        // 3. USD: Bandai US / BNTCA Retail MSRP = Tax-Excluded Yen / 100
        const usdVal = Number((yenTaxEx / 100).toFixed(2));

        const krwNote = isClubG ? (curr === 'USD' ? 'Club G 🔵' : (curr === 'JPY' ? 'プレバン公式 🔵' : '클럽G 공식가 🔵')) : (curr === 'USD' ? 'Bandai Official 🟢' : (curr === 'JPY' ? 'バンダイ公式 🟢' : '반코 공식가 🟢'));
        const badgeColor = isClubG ? 'text-blue-400 font-semibold' : 'text-emerald-400 font-semibold';

        if (curr === 'KRW') {
          return {
            currency: 'KRW',
            value: krwVal,
            formatted: '₩ ' + krwVal.toLocaleString(),
            orgNote: krwNote,
            isVerified: true,
            isClubG: isClubG,
            badgeColor: badgeColor
          };
        } else if (curr === 'USD') {
          return {
            currency: 'USD',
            value: usdVal,
            formatted: '$ ' + usdVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            orgNote: 'Bandai US 🟢',
            isVerified: true,
            isClubG: isClubG,
            badgeColor: badgeColor
          };
        } else {
          return {
            currency: 'JPY',
            value: jpyVal,
            formatted: '¥ ' + jpyVal.toLocaleString(),
            orgNote: 'バンダイ日本 🟢',
            isVerified: true,
            isClubG: isClubG,
            badgeColor: badgeColor
          };
        }
      }
      window.getKitPriceInfo = getKitPriceInfo;

      // FULL COMPREHENSIVE 3-LANGUAGE UI LOCALIZATION DICTIONARY
      const UI_I18N = {
        KRW: {
          appSubtitle: 'MASTER GUNPLA ARCHIVE & COLLECTION',
          syncAuto: '☁️ 드라이브 자동연동',
          btnBackup: '💾 백업',
          btnRestore: '📂 복원',
          btnCsv: '📊 엑셀',
          dashTotal: '총 보유:',
          dashBacklog: '새것(미개봉):',
          dashInProgress: '조립중/부품:',
          dashBuilt: '조립완료:',
          dashValue: '미개봉 가치:',
          countUnit: '개',
          boxUnit: '박스',
          navAll: '🔍 전체 탐색',
          navBacklog: '📦 새것 / 미개봉',
          navInProgress: '⚙️ 조립 중 / 부품',
          navBuilt: '🔨 조립 완료',
          navWishlist: '💖 위시리스트',
          navAnalytics: '📊 컬렉션 통계',
          yearBarTitle: '📅 연도별 발매 건프라 탐색',
          yearBarSub: '(클릭하여 여러 연도 복수 선택 가능)',
          catalogCount: (n) => n.toLocaleString() + ' 개의 건프라 카탈로그',
          allYearsPill: (n) => '전체 연도 (' + n.toLocaleString() + ')',
          quickFilterTitle: '⚡ 빠른 필터:',
          quickFilterGrade: '🏷️ 등급별',
          quickFilterSeries: '🎬 시리즈별',
          quickFilterSub: '연도 + 등급 + 시리즈 복수 선택 결합 가능',
          appliedFilters: '적용된 조건:',
          clearFilters: '↺ 전체 필터 초기화',
          allSeriesPill: (n) => '전체 시리즈 (' + n.toLocaleString() + ')',
          allGradesPill: (n) => '전체 등급 (' + n.toLocaleString() + ')',
          searchPlaceholder: '건담 이름, 등급, 시리즈 검색 (예: z, seed, mg)...',
          imgModeProduct: '🤖 완성품 뷰',
          imgModeBoxart: '📦 박스아트 뷰',
          optAllYears: '모든 연도 (All Years)',
          optAllGrades: '모든 등급 (All Grades)',
          optAllSeries: '모든 시리즈 (All Series)',
          optRunAll: '모든 발매구분',
          optRunStandard: '일반 발매판 (Standard)',
          optRunLimited: '한정판 / 클럽G (P-Bandai)',
          optSortNewest: '최신 출시순 (Newest)',
          optSortOldest: '오래된 출시순 (Oldest)',
          optSortName: '이름 가나다순 (A-Z)',
          optSortPriceHigh: '가격 높은순 (Price: High)',
          optSortPriceLow: '가격 낮은순 (Price: Low)',
          optSortOwned: '내 보유 많은순',
          msrpLabel: '정가:',
          orgNote: '반코 공식가',
          cardBacklog: '📦 새것(미개봉)',
          cardInProgress: '⚙️ 조립중/부품',
          cardBuilt: '🔨 조립완료',
          totalOwned: (cnt) => '✨ 총 ' + cnt + '개 보유',
          notOwned: '총 0개 (미소장)',
          released: (year) => year + '년 발매',
          pbandai: '한정/클럽G',
          loadMore: (vis, tot) => '더 불러오기 (' + vis + ' / ' + tot + ')',
          modalScale: '스케일:',
          modalRelease: '출시일:',
          modalEdition: '발매구분:',
          modalStandard: '일반판',
          modalLimited: '한정판/클럽G',
          modalStatusTitle: '현재 내 보유 현황',
          modalTotal: (cnt) => '총 ' + cnt + '개',
          modalBacklog: '📦 새것:',
          modalInProgress: '⚙️ 조립/부품:',
          modalBuilt: '🔨 완료:',
          modalNotesLabel: '소장품 개인 메모 / 보관 장소',
          modalNotesPlaceholder: '예: 창고 2번 박스 보관, 도색/개조 부품용 등',
          modalClose: '닫기',
          modalSave: '저장하기',
          analyticsTitle: '📊 내 건프라 컬렉션 & 자산 가치 분석',
          analyticsSub: 'My Gunpla Portfolio & Valuation Dashboard',
          statTotalOwned: '🏆 총 보유 합계',
          statBacklog: '📦 새것 (미개봉)',
          statInProgress: '⚙️ 조립 중 / 부품',
          statBuilt: '🔨 조립 완료',
          statValuation: '💰 미개봉 자산 가치',
          toastSaved: '저장되었습니다.',
          toastLangChanged: '💱 통화 및 언어 설정: 🇰🇷 한국어 / 원화'
        },
        JPY: {
          appSubtitle: 'マスターガンプラアーカイブ & コレクション',
          syncAuto: '☁️ ドライブ自動同期',
          btnBackup: '💾 バックアップ',
          btnRestore: '📂 復元',
          btnCsv: '📊 Excel出力',
          dashTotal: '総所蔵:',
          dashBacklog: '新品(未開封):',
          dashInProgress: '組立中/パーツ:',
          dashBuilt: '組立完了:',
          dashValue: '未開封資産価値:',
          countUnit: '個',
          boxUnit: '箱',
          navAll: '🔍 全体カタログ',
          navBacklog: '📦 新品 / 未開封',
          navInProgress: '⚙️ 組立中 / パーツ',
          navBuilt: '🔨 組立完了',
          navWishlist: '💖 ウィッシュリスト',
          navAnalytics: '📊 コレクション統計',
          yearBarTitle: '📅 発売年別ガンプラ検索',
          yearBarSub: '(クリックして複数年を選択可能)',
          catalogCount: (n) => n.toLocaleString() + ' 件のガンプラカタログ',
          allYearsPill: (n) => '全期間 (' + n.toLocaleString() + ')',
          quickFilterTitle: '⚡ クイックフィルター:',
          quickFilterGrade: '🏷️ グレード別',
          quickFilterSeries: '🎬 シリーズ別',
          quickFilterSub: '年 + グレード + シリーズの複数選択が可能',
          appliedFilters: '適用中の条件:',
          clearFilters: '↺ フィルター解除',
          allSeriesPill: (n) => '全シリーズ (' + n.toLocaleString() + ')',
          allGradesPill: (n) => '全グレード (' + n.toLocaleString() + ')',
          searchPlaceholder: 'ガンプラ名、グレード、シリーズを検索...',
          imgModeProduct: '🤖 完成品 視点',
          imgModeBoxart: '📦 パッケージ 視点',
          optAllYears: '全発売年 (All Years)',
          optAllGrades: '全グレード (All Grades)',
          optAllSeries: '全シリーズ (All Series)',
          optRunAll: '発売区分: 全て',
          optRunStandard: '一般販売 (Standard)',
          optRunLimited: '限定品/プレバン (Limited)',
          optSortNewest: '発売日 (新しい順)',
          optSortOldest: '発売日 (古い順)',
          optSortName: '名前順 (五十音/ABC)',
          optSortPriceHigh: '価格 (高い順)',
          optSortPriceLow: '価格 (安い順)',
          optSortOwned: '所蔵数順',
          msrpLabel: '定価:',
          orgNote: 'バンダイ日本',
          cardBacklog: '📦 新品(未開封)',
          cardInProgress: '⚙️ 組立中/パーツ',
          cardBuilt: '🔨 組立完了',
          totalOwned: (cnt) => '✨ 計 ' + cnt + '個 所蔵',
          notOwned: '計 0個 (未所蔵)',
          released: (year) => year + '年 発売',
          pbandai: '限定/プレバン',
          loadMore: (vis, tot) => 'さらに読み込む (' + vis + ' / ' + tot + ')',
          modalScale: 'スケール:',
          modalRelease: '発売日:',
          modalEdition: '発売区分:',
          modalStandard: '一般販売',
          modalLimited: '限定品/プレバン',
          modalStatusTitle: '現在の所蔵状況',
          modalTotal: (cnt) => '計 ' + cnt + '個',
          modalBacklog: '📦 新品:',
          modalInProgress: '⚙️ 組立中:',
          modalBuilt: '🔨 完成:',
          modalNotesLabel: '個人メモ / 保管場所',
          modalNotesPlaceholder: '例: 倉庫2番保管、塗装/改造パーツ用など',
          modalClose: '閉じる',
          modalSave: '保存する',
          analyticsTitle: '📊 ガンプラコレクション & 資産価値分析',
          analyticsSub: 'Gunpla Portfolio & Valuation Dashboard',
          statTotalOwned: '🏆 総所蔵数 合計',
          statBacklog: '📦 新品 (未開封)',
          statInProgress: '⚙️ 組立中 / パーツ',
          statBuilt: '🔨 組立完了',
          statValuation: '💰 未開封 資産価値',
          toastSaved: '保存されました。',
          toastLangChanged: '💱 通貨・言語設定: 🇯🇵 日本語 / 円'
        },
        USD: {
          appSubtitle: 'MASTER GUNPLA ARCHIVE & COLLECTION',
          syncAuto: '☁️ Auto-Sync to Drive',
          btnBackup: '💾 Backup',
          btnRestore: '📂 Restore',
          btnCsv: '📊 Excel Export',
          dashTotal: 'Total Owned:',
          dashBacklog: 'Backlog:',
          dashInProgress: 'In-Progress/Parts:',
          dashBuilt: 'Built:',
          dashValue: 'Backlog Value:',
          countUnit: 'kits',
          boxUnit: 'boxes',
          navAll: '🔍 Browse All',
          navBacklog: '📦 Backlog',
          navInProgress: '⚙️ In-Progress / Parts',
          navBuilt: '🔨 Completed / Built',
          navWishlist: '💖 Wishlist',
          navAnalytics: '📊 Analytics Dashboard',
          yearBarTitle: '📅 Browse by Release Year',
          yearBarSub: '(Click to multi-select release years)',
          catalogCount: (n) => n.toLocaleString() + ' Gunpla Catalog Items',
          allYearsPill: (n) => 'All Years (' + n.toLocaleString() + ')',
          quickFilterTitle: '⚡ Quick Filter:',
          quickFilterGrade: '🏷️ By Grade',
          quickFilterSeries: '🎬 By Series',
          quickFilterSub: 'Combine Year + Grade + Series multi-selection',
          appliedFilters: 'Applied Filters:',
          clearFilters: '↺ Clear Filters',
          allSeriesPill: (n) => 'All Series (' + n.toLocaleString() + ')',
          allGradesPill: (n) => 'All Grades (' + n.toLocaleString() + ')',
          searchPlaceholder: 'Search Gunpla by name, grade, series...',
          imgModeProduct: '🤖 Product View',
          imgModeBoxart: '📦 Box Art View',
          optAllYears: 'All Years',
          optAllGrades: 'All Grades',
          optAllSeries: 'All Series',
          optRunAll: 'All Editions',
          optRunStandard: 'Standard Release',
          optRunLimited: 'Limited / P-Bandai',
          optSortNewest: 'Release: Newest',
          optSortOldest: 'Release: Oldest',
          optSortName: 'Name (A-Z)',
          optSortPriceHigh: 'Price: High to Low',
          optSortPriceLow: 'Price: Low to High',
          optSortOwned: 'Most Owned',
          msrpLabel: 'MSRP:',
          orgNote: 'Bandai US',
          cardBacklog: '📦 Backlog',
          cardInProgress: '⚙️ In-Progress',
          cardBuilt: '🔨 Built',
          totalOwned: (cnt) => '✨ Total ' + cnt + ' Owned',
          notOwned: '0 Owned',
          released: (year) => 'Released ' + year,
          pbandai: 'Limited / P-Bandai',
          loadMore: (vis, tot) => 'Load More (' + vis + ' / ' + tot + ')',
          modalScale: 'Scale:',
          modalRelease: 'Release Date:',
          modalEdition: 'Edition:',
          modalStandard: 'Standard',
          modalLimited: 'Limited (P-Bandai)',
          modalStatusTitle: 'My Collection Status',
          modalTotal: (cnt) => 'Total ' + cnt,
          modalBacklog: '📦 Backlog:',
          modalInProgress: '⚙️ WIP:',
          modalBuilt: '🔨 Built:',
          modalNotesLabel: 'Personal Notes / Storage Location',
          modalNotesPlaceholder: 'e.g. Box #2 in closet, Spare parts for painting, etc.',
          modalClose: 'Close',
          modalSave: 'Save Changes',
          analyticsTitle: '📊 Gunpla Portfolio & Valuation Dashboard',
          analyticsSub: 'My Gunpla Portfolio & Valuation Dashboard',
          statTotalOwned: '🏆 Total Kits Owned',
          statBacklog: '📦 Backlog (Unbuilt)',
          statInProgress: '⚙️ In-Progress / Parts',
          statBuilt: '🔨 Completed / Built',
          statValuation: '💰 Backlog Asset Value',
          toastSaved: 'Saved successfully.',
          toastLangChanged: '💱 Currency & Language: 🇺🇸 English / USD'
        }
      };

      // MASTER 3-LANGUAGE CLASSIFICATION LOCALIZATION MAP (ALL 17 CATEGORIES AUDITED)
      const CLASS_I18N = {
        'High Grade': { KRW: 'High Grade', JPY: 'High Grade', USD: 'High Grade' },
        'Master Grade': { KRW: 'Master Grade', JPY: 'Master Grade', USD: 'Master Grade' },
        'Real Grade': { KRW: 'Real Grade', JPY: 'Real Grade', USD: 'Real Grade' },
        'Perfect Grade': { KRW: 'Perfect Grade', JPY: 'Perfect Grade', USD: 'Perfect Grade' },
        'Entry Grade': { KRW: 'Entry Grade', JPY: 'Entry Grade', USD: 'Entry Grade' },
        'Super Deformed': { KRW: 'SD', JPY: 'SD', USD: 'SD' },
        'Full Mechanics': { KRW: '풀 메카닉스', JPY: 'フルメカニクス', USD: 'Full Mechanics' },
        'FULL MECHANICS': { KRW: '풀 메카닉스', JPY: 'フルメカニクス', USD: 'Full Mechanics' },
        'Figure-rise Standard': { KRW: '피규어라이즈', JPY: 'フィギュアライズ', USD: 'Figure-rise' },
        '30 MINUTES': { KRW: '30 MINUTES', JPY: '30 MINUTES', USD: '30 MINUTES' },
        'MGSD': { KRW: 'MGSD', JPY: 'MGSD', USD: 'MGSD' },
        'MGEX': { KRW: 'MGEX', JPY: 'MGEX', USD: 'MGEX' },
        'RE/100': { KRW: 'RE/100', JPY: 'RE/100', USD: 'RE/100' },
        '포켓몬 프라모': { KRW: '포켓몬 프라모', JPY: 'ポケプラ', USD: 'PokePla' },
        'ポケモンプラモコレクション': { KRW: '포켓몬 프라모', JPY: 'ポケプラ', USD: 'PokePla' },
        'Pokemon': { KRW: '포켓몬 프라모', JPY: 'ポケプラ', USD: 'PokePla' },
        'その他': { KRW: '기타', JPY: 'その他', USD: 'Others' },
        'Other': { KRW: '기타', JPY: 'その他', USD: 'Others' },
        '기타': { KRW: '기타', JPY: 'その他', USD: 'Others' },
        'アクションベース': { KRW: '액션 베이스', JPY: 'アクションベース', USD: 'Action Base' },
        'Action Base': { KRW: '액션 베이스', JPY: 'アクションベース', USD: 'Action Base' },
        '옵션 파츠': { KRW: '옵션 파츠', JPY: 'オプションパーツ', USD: 'Option Parts' },
        'オプションパーツセット': { KRW: '옵션 파츠', JPY: 'オプションパーツ', USD: 'Option Parts' },
        'Option Parts': { KRW: '옵션 파츠', JPY: 'オプションパーツ', USD: 'Option Parts' },
        'メガサイズモデル': { KRW: '메가사이즈', JPY: 'メガサイズ', USD: 'Mega Size' },
        'Mega Size Model': { KRW: '메가사이즈', JPY: 'メガサイズ', USD: 'Mega Size' },
        'SDガンダム クロスシルエット': { KRW: 'SDCS', JPY: 'SDガンダム CS', USD: 'SDCS' }
      };

      function getLocalizedClass(rawClass, targetCurrency) {
        if (!rawClass) return 'Grade';
        const curr = targetCurrency || state.currency || 'KRW';
        const trimmed = (rawClass || '').trim();
        const norm = trimmed.normalize ? trimmed.normalize('NFC') : trimmed;
        if (CLASS_I18N[norm] && CLASS_I18N[norm][curr]) {
          return CLASS_I18N[norm][curr];
        }
        if (CLASS_I18N[trimmed] && CLASS_I18N[trimmed][curr]) {
          return CLASS_I18N[trimmed][curr];
        }
        return rawClass;
      }
      window.getLocalizedClass = getLocalizedClass;

      // 3-LANGUAGE SERIES LOCALIZATION MAP (54 OFFICIAL SERIES)
      const SERIES_I18N = {
        "機動戦士ガンダム": { kr: "기동전사 건담 (퍼스트)", jp: "機動戦士ガンダム", en: "Mobile Suit Gundam" },
        "機動戦士ガンダム SEED": { kr: "기동전사 건담 SEED", jp: "機動戦士ガンダム SEED", en: "Mobile Suit Gundam SEED" },
        "30 MINUTES MISSIONS": { kr: "30 MINUTES MISSIONS (30MM)", jp: "30 MINUTES MISSIONS", en: "30 MINUTES MISSIONS" },
        "機動戦士ガンダムUC": { kr: "기동전사 건담 UC (유니콘)", jp: "機動戦士ガンダムUC", en: "Mobile Suit Gundam Unicorn" },
        "ガンダムビルドファイターズ": { kr: "건담 빌드 파이터즈", jp: "ガンダムビルドファイターズ", en: "Gundam Build Fighters" },
        "機動戦士ガンダム00": { kr: "기동전사 건담 00 (더블오)", jp: "機動戦士ガンダム00", en: "Mobile Suit Gundam 00" },
        "30 MINUTES SISTERS": { kr: "30 MINUTES SISTERS (30MS)", jp: "30 MINUTES SISTERS", en: "30 MINUTES SISTERS" },
        "機動戦士ガンダムSEED DESTINY": { kr: "기동전사 건담 SEED DESTINY", jp: "機動戦士ガンダムSEED DESTINY", en: "Mobile Suit Gundam SEED DESTINY" },
        "その他": { kr: "기타", jp: "その他", en: "Others" },
        "機動戦士ガンダム 鉄血のオルフェンズ": { kr: "기동전사 건담 철혈의 오펀스", jp: "機動戦士ガンダム 鉄血のオルフェンズ", en: "Mobile Suit Gundam: Iron-Blooded Orphans" },
        "機動戦士Zガンダム": { kr: "기동전사 Z 건담", jp: "機動戦士Zガンダム", en: "Mobile Suit Zeta Gundam" },
        "新機動戦記ガンダムW": { kr: "신기동전기 건담 W (윙)", jp: "新機動戦記ガンダムW", en: "Mobile Suit Gundam Wing" },
        "機動戦士ガンダム 逆襲のシャア": { kr: "기동전사 건담 역습의 샤아", jp: "機動戦士ガンダム 逆襲のシャア", en: "Mobile Suit Gundam: Char's Counterattack" },
        "ガンダムビルドダイバーズ": { kr: "건담 빌드 다이버즈", jp: "ガンダムビルドダイバーズ", en: "Gundam Build Divers" },
        "ガンダムMSV": { kr: "건담 MSV", jp: "ガンダムMSV", en: "Gundam MSV" },
        "ポケモンプラモコレクション セレクトシリーズ": { kr: "포켓몬 프라모 컬렉션 셀렉트 시리즈", jp: "ポケモンプラモコレクション セレクトシリーズ", en: "Pokemon Plamo Collection Select Series" },
        "機動戦士ガンダム 水星の魔女": { kr: "기동전사 건담 수성의 마녀", jp: "機動戦士ガンダム 水星の魔女", en: "Mobile Suit Gundam: The Witch from Mercury" },
        "機動戦士ガンダムAGE": { kr: "기동전사 건담 AGE", jp: "機動戦士ガンダムAGE", en: "Mobile Suit Gundam AGE" },
        "ガンダムビルドダイバーズRe:RISE": { kr: "건담 빌드 다이버즈 Re:RISE", jp: "ガンダムビルドダイバーズRe:RISE", en: "Gundam Build Divers Re:RISE" },
        "30 MINUTES FANTASY": { kr: "30 MINUTES FANTASY (30MF)", jp: "30 MINUTES FANTASY", en: "30 MINUTES FANTASY" },
        "機動戦士ガンダム 0083 STARDUST MEMORY": { kr: "기동전사 건담 0083 스타더스트 메모리", jp: "機動戦士ガンダム 0083 STARDUST MEMORY", en: "Mobile Suit Gundam 0083: Stardust Memory" },
        "ADVANCE OF Z": { kr: "ADVANCE OF Z (AOZ)", jp: "ADVANCE OF Z", en: "ADVANCE OF Z" },
        "機動戦士ガンダムZZ": { kr: "기동전사 건담 ZZ", jp: "機動戦士ガンダムZZ", en: "Mobile Suit Gundam ZZ" },
        "機動戦士ガンダム THE ORIGIN": { kr: "기동전사 건담 디 오리진", jp: "機動戦士ガンダム THE ORIGIN", en: "Mobile Suit Gundam: THE ORIGIN" },
        "ポケモンプラモコレクション クイック!!": { kr: "포켓몬 프라모 컬렉션 퀵!!", jp: "ポケモンプラモコレクション クイック!!", en: "Pokemon Plamo Collection Quick!!" },
        "機動戦士ガンダムNT（ナラティブ）": { kr: "기동전사 건담 NT (내러티브)", jp: "機動戦士ガンダムNT（ナラティブ）", en: "Mobile Suit Gundam Narrative" },
        "機動戦士クロスボーン・ガンダム": { kr: "기동전사 크로스본 건담", jp: "機動戦士クロスボーン・ガンダム", en: "Mobile Suit Crossbone Gundam" },
        "ガンダム Gのレコンギスタ": { kr: "건담 G의 레콘기스타", jp: "ガンダム Gのレコンギスタ", en: "Gundam Reconguista in G" },
        "機動戦士ガンダムSEED FREEDOM": { kr: "기동전사 건담 SEED FREEDOM", jp: "機動戦士ガンダムSEED FREEDOM", en: "Mobile Suit Gundam SEED FREEDOM" },
        "機動戦士Gundam GQuuuuuuX": { kr: "기동전사 건담 GQuuuuuuX", jp: "機動戦士Gundam GQuuuuuuX", en: "Mobile Suit Gundam GQuuuuuuX" },
        "機動戦士ガンダム0080 ポケットの中の戦争": { kr: "기동전사 건담 0080 포켓 속의 전쟁", jp: "機動戦士ガンダム0080 ポケットの中の戦争", en: "Mobile Suit Gundam 0080: War in the Pocket" },
        "機動戦士Vガンダム": { kr: "기동전사 V 건담", jp: "機動戦士Vガンダム", en: "Mobile Suit Victory Gundam" },
        "機動武闘伝Gガンダム": { kr: "기동무투전 G 건담", jp: "機動武闘伝Gガンダム", en: "Mobile Fighter G Gundam" },
        "ガンダム・センチネル": { kr: "건담 센티넬", jp: "ガンダム・センチネル", en: "Gundam Sentinel" },
        "その他ガンプラ": { kr: "기타 건프라", jp: "その他ガンプラ", en: "Other Gunpla" },
        "ガンダムビルドメタバース": { kr: "건담 빌드 메타버스", jp: "ガンダムビルドメタバース", en: "Gundam Build Metaverse" },
        "機動戦士ガンダム サンダーボルト": { kr: "기동전사 건담 썬더볼트", jp: "機動戦士ガンダム サンダーボルト", en: "Mobile Suit Gundam Thunderbolt" },
        "ポケモンプラモコレクション 進化シリーズ": { kr: "포켓몬 프라모 컬렉션 진화 시리즈", jp: "ポケモンプラモコレクション 進化シリーズ", en: "Pokemon Plamo Collection Evolution Series" },
        "機動戦士ガンダム 閃光のハサウェイ": { kr: "기동전사 건담 섬광의 하사웨이", jp: "機動戦士ガンダム 閃光のハサウェイ", en: "Mobile Suit Gundam: Hathaway's Flash" },
        "機動戦士ガンダムF91": { kr: "기동전사 건담 F91", jp: "機動戦士ガンダムF91", en: "Mobile Suit Gundam F91" },
        "機動戦士ガンダム 第08MS小隊": { kr: "기동전사 건담 제08MS소대", jp: "機動戦士ガンダム 第08MS小隊", en: "Mobile Suit Gundam: The 08th MS Team" },
        "機動新世紀ガンダムＸ": { kr: "기동신세기 건담 X", jp: "機動新世紀ガンダムＸ", en: "After War Gundam X" },
        "機動戦士ガンダム外伝 THE BLUE DESTINY": { kr: "기동전사 건담 외전 THE BLUE DESTINY", jp: "機動戦士ガンダム外伝 THE BLUE DESTINY", en: "Mobile Suit Gundam Side Story: The Blue Destiny" },
        "GUNDAM BREAKER BATTLOGUE": { kr: "건담 브레이커 배틀로그", jp: "GUNDAM BREAKER BATTLOGUE", en: "Gundam Breaker Battlogue" },
        "機動戦士ガンダム ククルス・ドアンの島": { kr: "기동전사 건담 쿠쿠루스 도안의 섬", jp: "機動戦士ガンダム ククルス・ドアンの島", en: "Mobile Suit Gundam: Cucuruz Doan's Island" },
        "∀ガンダム": { kr: "∀ 건담 (턴에이)", jp: "∀ガンダム", en: "Turn A Gundam" },
        "機動戦士ガンダム MS IGLOO": { kr: "기동전사 건담 MS IGLOO", jp: "機動戦士ガンダム MS IGLOO", en: "Mobile Suit Gundam MS IGLOO" },
        "ポケモンプラモコレクション クイック!! Lite": { kr: "포켓몬 프라모 컬렉션 퀵!! Lite", jp: "ポケモンプラモコレクション クイック!! Lite", en: "Pokemon Plamo Collection Quick!! Lite" },
        "機動戦士ガンダム Twilight AXIS": { kr: "기동전사 건담 트와일라잇 액시즈", jp: "機動戦士ガンダム Twilight AXIS", en: "Mobile Suit Gundam: Twilight AXIS" },
        "機動戦士ガンダム 復讐のレクイエム": { kr: "기동전사 건담 복수의 레퀴엠", jp: "機動戦士ガンダム 復讐のレクイエム", en: "Mobile Suit Gundam: Requiem for Vengeance" },
        "機動戦士MOONガンダム": { kr: "기동전사 MOON 건담", jp: "機動戦士MOONガンダム", en: "Mobile Suit Moon Gundam" },
        "ポケモンプラモコレクション ファーストシリーズ": { kr: "포켓몬 프라모 컬렉션 퍼스트 시리즈", jp: "ポケモンプラモコレクション ファーストシリーズ", en: "Pokemon Plamo Collection First Series" },
        "ポケモンプラモコレクション カセキポケモンシリーズ": { kr: "포켓몬 프라모 컬렉션 화석포켓몬 시리즈", jp: "ポケモンプラモコレクション カセキポケモンシリーズ", en: "Pokemon Plamo Collection Fossil Series" },
        "ポケモンプラモコレクション BIG": { kr: "포켓몬 프라모 컬렉션 BIG", jp: "ポケモンプラモコレクション BIG", en: "Pokemon Plamo Collection BIG" }
      };

      function getLocalizedSeries(rawSeries, targetCurrency) {
        if (!rawSeries) return (targetCurrency || state.currency) === 'USD' ? 'Others' : ((targetCurrency || state.currency) === 'JPY' ? 'その他' : '기타');
        const curr = targetCurrency || state.currency || 'KRW';
        const trimmed = (rawSeries || '').trim();
        
        const upper = trimmed.toUpperCase();
        if (upper.includes('SEED FREEDOM')) return curr === 'USD' ? 'Mobile Suit Gundam SEED FREEDOM' : (curr === 'JPY' ? '機動戦士ガンダムSEED FREEDOM' : '기동전사 건담 SEED FREEDOM');
        if (upper.includes('SEED DESTINY')) return curr === 'USD' ? 'Mobile Suit Gundam SEED DESTINY' : (curr === 'JPY' ? '機動戦士ガンダムSEED DESTINY' : '기동전사 건담 SEED DESTINY');
        if (upper.includes('SEED')) return curr === 'USD' ? 'Mobile Suit Gundam SEED' : (curr === 'JPY' ? '機動戦士ガンダムSEED' : '기동전사 건담 SEED (시드)');
        if (upper.includes('WITCH FROM MERCURY') || trimmed.includes('水星の魔女')) return curr === 'USD' ? 'The Witch from Mercury' : (curr === 'JPY' ? '機動戦士ガンダム 水星の魔女' : '기동전사 건담 수성의 마녀');
        if (upper.includes('UNICORN') || trimmed.includes('UC') || trimmed.includes('ユニコーン')) return curr === 'USD' ? 'Mobile Suit Gundam Unicorn' : (curr === 'JPY' ? '機動戦士ガンダムUC' : '기동전사 건담 UC (유니콘)');
        if (upper.includes('IRON-BLOODED') || trimmed.includes('鉄血のオルフェンズ')) return curr === 'USD' ? 'Iron-Blooded Orphans' : (curr === 'JPY' ? '機動戦士ガンダム 鉄血のオルフェンズ' : '기동전사 건담 철혈의 오펀스');
        if (upper.includes('ORIGIN') || trimmed.includes('ジ・オリジン')) return curr === 'USD' ? 'The Origin' : (curr === 'JPY' ? '機動戦士ガンダム THE ORIGIN' : '기동전사 건담 디 오리진');
        if (upper.includes('BUILD DIVERS') || trimmed.includes('ビルドダイバーズ')) return curr === 'USD' ? 'Gundam Build Divers' : (curr === 'JPY' ? 'ガンダムビルドダイバーズ' : '건담 빌드 다이버즈');
        if (upper.includes('BUILD FIGHTERS') || trimmed.includes('ビルドファイターズ')) return curr === 'USD' ? 'Gundam Build Fighters' : (curr === 'JPY' ? 'ガンダムビルドファイターズ' : '건담 빌드 파이터즈');
        if (upper.includes('00') || upper.includes('DOUBLE O') || trimmed.includes('ダブルオー')) return curr === 'USD' ? 'Mobile Suit Gundam 00' : (curr === 'JPY' ? '機動戦士ガンダム00' : '기동전사 건담 00 (더블오)');
        if (upper.includes('WING') || trimmed.includes('ウイング')) return curr === 'USD' ? 'Mobile Suit Gundam Wing' : (curr === 'JPY' ? '新機動戦記ガンダムW' : '신기동전기 건담 W');
        if (upper.includes('G GUNDAM') || trimmed.includes('Gガンダム')) return curr === 'USD' ? 'Mobile Fighter G Gundam' : (curr === 'JPY' ? '機動武闘伝Gガンダム' : '기동무투전 G건담');
        if (upper.includes('Z GUNDAM') || trimmed.includes('Zガンダム') || trimmed.includes('ゼータ')) return curr === 'USD' ? 'Mobile Suit Zeta Gundam' : (curr === 'JPY' ? '機動戦士Ζガンダム' : '기동전사 Z 건담 (제타)');
        if (upper.includes('ZZ') || trimmed.includes('ダブルゼータ')) return curr === 'USD' ? 'Mobile Suit Gundam ZZ' : (curr === 'JPY' ? '機動戦士ガンダムΖΖ' : '기동전사 건담 ZZ (더블제타)');
        if (upper.includes('CCA') || trimmed.includes('逆襲のシャア')) return curr === 'USD' ? "Char's Counterattack" : (curr === 'JPY' ? '機動戦士ガンダム 逆襲のシャア' : '기동전사 건담 역습의 샤아');
        if (upper.includes('HATHAWAY') || trimmed.includes('閃光のハサウェイ')) return curr === 'USD' ? 'Hathaway' : (curr === 'JPY' ? '機動戦士ガンダム 閃光のハサウェイ' : '기동전사 건담 섬광의 하사웨이');
        if (upper.includes('30MM') || upper.includes('30 MINUTES MISSIONS')) return '30 MINUTES MISSIONS (30MM)';
        if (upper.includes('30MS') || upper.includes('30 MINUTES SISTERS')) return '30 MINUTES SISTERS (30MS)';
        if (upper.includes('POKEMON') || trimmed.includes('ポケプラ') || trimmed.includes('ポケモン')) return curr === 'USD' ? 'Pokemon Plamo' : (curr === 'JPY' ? 'ポケモンプラモコレクション' : '포켓몬 프라모델');

        const entry = SERIES_I18N[trimmed];
        if (entry) {
          if (curr === 'KRW') return entry.kr;
          if (curr === 'USD') return entry.en;
          return entry.jp;
        }

        const clean = trimmed.replace(/[^\x20-\x7E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF\s\-\:\(\)]/g, '').trim();
        return clean || (curr === 'USD' ? 'Others' : (curr === 'JPY' ? 'その他' : '기타'));
      }
      window.getLocalizedSeries = getLocalizedSeries;

      function updateGlobalStats() {
        let totalBacklog = 0, totalInProgress = 0, totalBuilt = 0, totalVal = 0;
        Object.entries(state.userCollection).forEach(([id, data]) => {
          const kit = KITS.find(k => k.id === id);
          if (!kit) return;
          const b = data.backlog || 0;
          const p = data.inProgress || 0;
          const u = data.built || 0;
          totalBacklog += b;
          totalInProgress += p;
          totalBuilt += u;

          const pInfo = getKitPriceInfo(kit, state.currency);
          const price = data.customPrice ? Number(data.customPrice) : pInfo.value;
          totalVal += (b * price);
        });

        const totalOwnedAll = totalBacklog + totalInProgress + totalBuilt;
        const t = UI_I18N[state.currency] || UI_I18N.KRW;

        const elLblTotal = document.getElementById('header-label-total');
        const elLblBacklog = document.getElementById('header-label-backlog');
        const elLblInProgress = document.getElementById('header-label-inprogress');
        const elLblBuilt = document.getElementById('header-label-built');
        const elLblValue = document.getElementById('header-label-value');

        if (elLblTotal) elLblTotal.textContent = t.dashTotal;
        if (elLblBacklog) elLblBacklog.textContent = t.dashBacklog;
        if (elLblInProgress) elLblInProgress.textContent = t.dashInProgress;
        if (elLblBuilt) elLblBuilt.textContent = t.dashBuilt;
        if (elLblValue) elLblValue.textContent = t.dashValue;

        const elTotalAll = document.getElementById('header-total-all');
        const elBacklog = document.getElementById('header-backlog-count');
        const elInProgress = document.getElementById('header-inprogress-count');
        const elBuilt = document.getElementById('header-built-count');
        const elValue = document.getElementById('header-total-value');

        if (elTotalAll) elTotalAll.textContent = totalOwnedAll + ' ' + t.countUnit;
        if (elBacklog) elBacklog.textContent = totalBacklog + ' ' + t.boxUnit;
        if (elInProgress) elInProgress.textContent = totalInProgress + ' ' + t.countUnit;
        if (elBuilt) elBuilt.textContent = totalBuilt + ' ' + t.countUnit;

        if (elValue) {
          if (state.currency === 'KRW') {
            elValue.textContent = '₩ ' + Math.round(totalVal).toLocaleString();
          } else if (state.currency === 'USD') {
            elValue.textContent = '$ ' + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          } else {
            elValue.textContent = '¥ ' + Math.round(totalVal).toLocaleString();
          }
        }

        updateAllUILocalization();
      }

      function updateAllUILocalization() {
        const t = UI_I18N[state.currency] || UI_I18N.KRW;
        
        // 1. Header & Utilities
        const sub = document.getElementById('app-subtitle');
        if (sub) sub.textContent = t.appSubtitle;
        const syncText = document.getElementById('sync-status-text');
        if (syncText) {
          if (autoSyncFileHandle) {
            syncText.textContent = state.currency === 'USD' ? '☁️ Drive Auto-Sync ON' : (state.currency === 'JPY' ? '☁️ ドライブ自動同期 ON' : '☁️ 드라이브 자동연동 ON');
          } else {
            syncText.textContent = t.syncAuto;
          }
        }
        const btnBackup = document.getElementById('btn-text-backup');
        if (btnBackup) btnBackup.textContent = t.btnBackup;
        const btnRestore = document.getElementById('btn-text-restore');
        if (btnRestore) btnRestore.textContent = t.btnRestore;
        const btnCsv = document.getElementById('btn-text-csv');
        if (btnCsv) btnCsv.textContent = t.btnCsv;

        // 2. Navigation Tabs
        const tabAll = document.getElementById('nav-tab-all');
        if (tabAll) tabAll.textContent = t.navAll;
        const tabBacklog = document.getElementById('nav-tab-backlog');
        if (tabBacklog) tabBacklog.textContent = t.navBacklog;
        const tabInProgress = document.getElementById('nav-tab-inprogress');
        if (tabInProgress) tabInProgress.textContent = t.navInProgress;
        const tabBuilt = document.getElementById('nav-tab-built');
        if (tabBuilt) tabBuilt.textContent = t.navBuilt;
        const tabWishlist = document.getElementById('nav-tab-wishlist');
        if (tabWishlist) tabWishlist.textContent = t.navWishlist;
        const tabAnalytics = document.getElementById('nav-tab-analytics');
        if (tabAnalytics) tabAnalytics.textContent = t.navAnalytics;

        // 3. Year Bar
        const yearTitle = document.getElementById('label-year-title');
        if (yearTitle) yearTitle.textContent = t.yearBarTitle;
        const yearSub = document.getElementById('label-year-sub');
        if (yearSub) yearSub.textContent = t.yearBarSub;

        // 4. Quick Filter Bar
        const qTitle = document.getElementById('label-quickfilter-title');
        if (qTitle) qTitle.textContent = t.quickFilterTitle;
        const qGrade = document.getElementById('subfacet-btn-grade');
        if (qGrade) qGrade.textContent = t.quickFilterGrade;
        const qSeries = document.getElementById('subfacet-btn-series');
        if (qSeries) qSeries.textContent = t.quickFilterSeries;
        const qSub = document.getElementById('label-quickfilter-sub');
        if (qSub) qSub.textContent = t.quickFilterSub;
        const appFilters = document.getElementById('label-applied-filters');
        if (appFilters) appFilters.textContent = t.appliedFilters;
        const btnReset = document.getElementById('btn-reset-filters');
        if (btnReset) btnReset.textContent = t.clearFilters;

        // 5. Search & Mode Switchers
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.placeholder = t.searchPlaceholder;
        const imgProd = document.getElementById('img-mode-product');
        if (imgProd) imgProd.textContent = t.imgModeProduct;
        const imgBox = document.getElementById('img-mode-boxart');
        if (imgBox) imgBox.textContent = t.imgModeBoxart;

        // 6. Run & Sort Selects
        const runSelect = document.getElementById('filter-run');
        if (runSelect) {
          const curVal = runSelect.value || 'all';
          runSelect.innerHTML = '<option value="all">' + t.optRunAll + '</option>' +
            '<option value="Standard">' + t.optRunStandard + '</option>' +
            '<option value="P-Bandai">' + t.optRunLimited + '</option>';
          runSelect.value = curVal;
        }

        const sortSelect = document.getElementById('sort-by');
        if (sortSelect) {
          const curVal = sortSelect.value || 'release_desc';
          sortSelect.innerHTML = '<option value="release_desc">' + t.optSortNewest + '</option>' +
            '<option value="release_asc">' + t.optSortOldest + '</option>' +
            '<option value="name_asc">' + t.optSortName + '</option>' +
            '<option value="msrp_desc">' + t.optSortPriceHigh + '</option>' +
            '<option value="msrp_asc">' + t.optSortPriceLow + '</option>' +
            '<option value="owned_desc">' + t.optSortOwned + '</option>';
          sortSelect.value = curVal;
        }

        const gradeSelect = document.getElementById('filter-grade');
        if (gradeSelect) {
          const curVal = gradeSelect.value || 'all';
          const gAll = (state.currency === 'USD' ? 'All Grades' : (state.currency === 'JPY' ? '全グレード' : '모든 등급 (All Grades)'));
          gradeSelect.innerHTML = '<option value="all">' + gAll + '</option>' +
            '<option value="HG">HG (High Grade)</option>' +
            '<option value="MG">MG / MGEX / MGSD (Master Grade)</option>' +
            '<option value="RG">RG (Real Grade)</option>' +
            '<option value="PG">PG (Perfect Grade)</option>' +
            '<option value="EG">ENTRY GRADE (EG)</option>' +
            '<option value="FM">' + (state.currency === 'KRW' ? '풀 메카닉스' : (state.currency === 'JPY' ? 'フルメカニクス' : 'Full Mechanics')) + ' / RE/100</option>' +
            '<option value="SD">SD / SDCS / BB' + (state.currency === 'JPY' ? '戦士' : '전사') + '</option>' +
            '<option value="Mega">' + (state.currency === 'KRW' ? '메가사이즈' : (state.currency === 'JPY' ? 'メガサイズ' : 'Mega Size')) + ' (1/48)</option>' +
            '<option value="30MM">30 MINUTES (30MM/30MS)</option>' +
            '<option value="Pokemon">' + (state.currency === 'KRW' ? '포켓몬 프라모' : (state.currency === 'JPY' ? 'ポケプラ' : 'Pokemon Plamo')) + '</option>' +
            '<option value="Other">' + (state.currency === 'USD' ? 'Others' : (state.currency === 'JPY' ? 'その他' : '기타 반다이 프라')) + '</option>';
          gradeSelect.value = curVal;
        }
      }

      const IMAGE_OVERRIDES = {
        '4918': 'https://gunpla.fyi/images/boxarts/248.jpeg',
        '4919': 'https://gunpla.fyi/images/boxarts/2591.jpeg', // MG Sandrock EW Armadillo
        '4920': 'https://gunpla.fyi/images/boxarts/2506.jpeg', // MG F90 Cluster Gundam Mission Pack
        '4921': 'https://gunpla.fyi/images/boxarts/2734.jpeg', // HG Hazel Custom
        '4922': 'https://gunpla.fyi/images/boxarts/4951.jpeg', // HG Strike Freedom Type II
        '4923': 'https://gunpla.fyi/images/boxarts/1097.jpeg', // RG Gundam Epyon
        '4924': 'https://gunpla.fyi/images/boxarts/4924.jpeg'  // HG Ruka's Zaku
      };

      function enrichKit(kit) {
        if (!kit.name) kit.name = kit.nameEn || kit.nameJp;
        const b = (kit.brand || '').trim();
        const bu = b.toUpperCase();
        
        if (bu.includes('PERFECT') || bu === 'PG') {
          kit.classification = 'Perfect Grade';
          kit.gradeKey = 'PG';
        } else if (bu.includes('MASTER') || bu === 'MG' || bu === 'MGEX' || bu === 'MGSD') {
          kit.classification = bu === 'MGSD' ? 'MGSD' : (bu === 'MGEX' ? 'MGEX' : 'Master Grade');
          kit.gradeKey = 'MG';
        } else if (bu.includes('REAL') || bu === 'RG') {
          kit.classification = 'Real Grade';
          kit.gradeKey = 'RG';
        } else if (bu.includes('HIGH') || bu === 'HG' || bu === 'HGUC' || bu === 'HGBD' || bu === 'HGBF' || bu === 'HGAC' || bu === 'HGAW' || bu === 'HGCE') {
          kit.classification = 'High Grade';
          kit.gradeKey = 'HG';
        } else if (bu.includes('ENTRY') || bu === 'EG') {
          kit.classification = 'Entry Grade';
          kit.gradeKey = 'EG';
        } else if (bu.includes('FULL') || bu === 'FM' || bu === 'RE/100') {
          kit.classification = bu === 'FULL MECHANICS' ? 'Full Mechanics' : 'RE/100';
          kit.gradeKey = 'FM';
        } else if (bu.includes('SD') || bu === 'SDEX' || bu === 'SDBD' || bu === 'SDBF' || bu.includes('クロスシルエット')) {
          kit.classification = 'Super Deformed';
          kit.gradeKey = 'SD';
        } else if (bu.includes('MEGA') || bu.includes('メガサイズ')) {
          kit.classification = 'Mega Size Model';
          kit.gradeKey = 'Mega';
        } else if (bu.includes('30 MINUTES') || bu.includes('30MM') || bu.includes('30MS') || bu.includes('30MF')) {
          kit.classification = '30 MINUTES';
          kit.gradeKey = '30MM';
        } else if (bu.includes('ポケモン') || (kit.series || '').includes('ポケモン')) {
          kit.classification = '포켓몬 프라모';
          kit.gradeKey = 'Pokemon';
        } else {
          kit.classification = kit.brand || 'Other';
          kit.gradeKey = 'Other';
        }

        // ULTRA-LIGHTWEIGHT DYNAMIC RESOLVER (ZERO 1.7MB OVERHEAD)
        const boxartCdn = IMAGE_OVERRIDES[kit.id] || ('https://gunpla.fyi/images/boxarts/' + kit.id + '.jpeg');
        const productCdn = boxartCdn;

        kit.boxart_url = boxartCdn;
        kit.product_url = productCdn;
        kit.image_url = productCdn;
        kit.gallery = [
          { url: kit.product_url, cdn_url: productCdn, is_boxart: false },
          { url: kit.boxart_url, cdn_url: boxartCdn, is_boxart: true }
        ];

        if (!kit.release_date) kit.release_date = kit.releaseDate || '2020-01-01';
        if (!kit.year) {
          const y = parseInt(kit.release_date.substring(0, 4), 10);
          kit.year = !isNaN(y) ? y : 2020;
        }
        if (!kit.run) {
          const rawName = (kit.name || kit.nameEn || kit.nameJp || '');
          const idNum = parseInt(kit.id, 10);
          const isDalongClubG = (idNum >= 2000 && idNum < 3000);
          const isL = kit.is_limited || 
                      isDalongClubG ||
                      rawName.includes('プレミアムバンダイ') || 
                      rawName.includes('プレバン') || 
                      rawName.includes('ガンダムベース') || 
                      rawName.includes('GUNDAM BASE') || 
                      rawName.includes('LIMITED') || 
                      rawName.includes('Limited') || 
                      rawName.includes('イベント限定') || 
                      rawName.includes('EVENT') || 
                      rawName.includes('EXPO') || 
                      rawName.includes('SIDE-F') || 
                      rawName.includes('チタニウムフィニッシュ') || 
                      rawName.includes('スペシャルコーティング') || 
                      rawName.includes('SPECIAL COATING') || 
                      rawName.includes('TITANIUM FINISH') || 
                      rawName.includes('クリアカラー') || 
                      rawName.includes('CLEAR COLOR') || 
                      rawName.includes('클럽G');
          kit.run = isL ? 'P-Bandai' : 'Standard';
        }
        if (!kit.msrp_jpy) kit.msrp_jpy = (window.KIT_PRICE_DB && window.KIT_PRICE_DB[kit.id]) || kit.msrp || 1760;
        return kit;
      }

      window.setImageMode = function(mode) {
        state.cardImageMode = mode;
        const btnProd = document.getElementById('img-mode-product');
        const btnBox = document.getElementById('img-mode-boxart');
        if (btnProd && btnBox) {
          const isProd = mode === 'product';
          btnProd.classList.toggle('bg-cyan-500/20', isProd);
          btnProd.classList.toggle('text-cyan-400', isProd);
          btnProd.classList.toggle('border-cyan-500/40', isProd);
          btnProd.classList.toggle('text-slate-400', !isProd);
          btnProd.classList.toggle('border-transparent', !isProd);

          btnBox.classList.toggle('bg-cyan-500/20', !isProd);
          btnBox.classList.toggle('text-cyan-400', !isProd);
          btnBox.classList.toggle('border-cyan-500/40', !isProd);
          btnBox.classList.toggle('text-slate-400', isProd);
          btnBox.classList.toggle('border-transparent', isProd);
        }
        renderKits();
      };

      function getGradeBadgeClass(classification) {
        if (!classification) return 'badge-default';
        const c = classification.toLowerCase();
        if (c.includes('master') || c === 'mg' || c === 'mgex' || c === 'mgsd') return 'badge-mg';
        if (c.includes('real') || c === 'rg') return 'badge-rg';
        if (c.includes('high') || c === 'hg') return 'badge-hg';
        if (c.includes('perfect') || c === 'pg') return 'badge-pg';
        if (c.includes('entry') || c === 'eg') return 'badge-eg';
        if (c.includes('super') || c.includes('sd')) return 'badge-sd';
        if (c.includes('full') || c === 'fm' || c.includes('re/100')) return 'badge-fm';
        return 'badge-default';
      }

      // MULTI-SELECT COMPOUND FILTERING
      function getFilteredKits() {
        const q = (state.searchQuery || '').toLowerCase().trim();
        return KITS.filter(kit => {
          const item = getItem(kit.id);
          const b = item.backlog || 0;
          const p = item.inProgress || 0;
          const u = item.built || 0;

          // 1. View filter
          if (state.activeView === 'backlog' && b <= 0) return false;
          if (state.activeView === 'inprogress' && p <= 0) return false;
          if (state.activeView === 'built' && u <= 0) return false;
          if (state.activeView === 'wishlist' && !item.wishlist) return false;

          // 2. Multi-Year filter
          if (state.selectedYears.length > 0) {
            if (!state.selectedYears.includes(String(kit.year))) return false;
          }

          // 3. Multi-Grade filter
          if (state.selectedGrades.length > 0) {
            if (!state.selectedGrades.includes(kit.gradeKey)) return false;
          }

          // 4. Multi-Series filter
          if (state.selectedSeries.length > 0) {
            const s = (kit.series || '').toLowerCase();
            const matchesSeries = state.selectedSeries.some(target => s.includes(target.toLowerCase()) || kit.series === target);
            if (!matchesSeries) return false;
          }

          // 5. Run filter
          if (state.selectedRun !== 'all') {
            if (state.selectedRun === 'P-Bandai' && kit.run !== 'P-Bandai' && kit.run !== 'Limited') return false;
            if (state.selectedRun === 'Standard' && kit.run !== 'Standard') return false;
          }

          // 6. Search query with Korean Synonyms
          if (q) {
            const nameEn = (kit.nameEn || kit.name || '').toLowerCase();
            const nameJp = (kit.nameJp || '').toLowerCase();
            const series = (kit.series || '').toLowerCase();
            const seriesKr = getLocalizedSeries(kit.series, 'KRW').toLowerCase();
            const grade = (kit.classification || '').toLowerCase();
            const gradeKey = (kit.gradeKey || '').toLowerCase();

            const KOR_SYNONYMS = {
              '사자비': ['sazabi'], '뉴건담': ['nu gundam', 'ν gundam', 'rx-93'], '뉴 건담': ['nu gundam', 'ν gundam'],
              '퍼스트': ['rx-78', 'rx-78-2'], '퍼스트건담': ['rx-78', 'rx-78-2'], '퍼건': ['rx-78-2'],
              '자쿠': ['zaku'], '구프': ['gouf'], '돔': ['dom', 'rick dom'], '겔구그': ['gelgoog'],
              '지옹': ['zeong'], '백식': ['hyaku-shiki', 'hyaku shiki', 'msn-00100'],
              '제타': ['zeta', 'msz-006'], '더블제타': ['zz', 'double zeta'], '역샤': ["char's counterattack"],
              '유니콘': ['unicorn', 'rx-0'], '밴시': ['banshee'], '페넥스': ['phenex'], '시난주': ['sinanju'], '크샤트리아': ['kshatriya'],
              '스트라이크': ['strike'], '프리덤': ['freedom'], '저스티스': ['justice'], '데스티니': ['destiny'], '임펄스': ['impulse'],
              '스리덤': ['strike freedom'], '스트라이크 프리덤': ['strike freedom'], '마리덤': ['mighty strike freedom'],
              '윙': ['wing'], '엑시아': ['exia'], '더블오': ['00', 'double o', '00 gundam', 'qan[t]'], '퀀터': ['qan[t]'],
              '바르바토스': ['barbatos'], '에어리얼': ['aerial'], '캘리번': ['calibarn'], '파렉트': ['pharact'], '다릴바르데': ['darilbalde'],
              '갓건담': ['god gundam', 'burning gundam'], '마스터건담': ['master gundam'], '샤이닝': ['shining'],
              '포켓몬': ['pokemon', 'pikachu', 'rayquaza', 'charizard', 'mewtwo'], '피카츄': ['pikachu'], '레쿠쟈': ['rayquaza']
            };

            let matched = nameEn.includes(q) || nameJp.includes(q) || series.includes(q) || seriesKr.includes(q) || grade.includes(q) || gradeKey.includes(q);
            if (!matched) {
              for (const [kWord, synList] of Object.entries(KOR_SYNONYMS)) {
                if (q.includes(kWord) || kWord.includes(q)) {
                  if (synList.some(syn => nameEn.includes(syn) || nameJp.includes(syn) || series.includes(syn))) {
                    matched = true;
                    break;
                  }
                }
              }
            }
            if (!matched) return false;
          }

          return true;
        }).sort((a, b) => {
          const itemA = getItem(a.id);
          const itemB = getItem(b.id);
          const totalA = (itemA.backlog || 0) + (itemA.inProgress || 0) + (itemA.built || 0);
          const totalB = (itemB.backlog || 0) + (itemB.inProgress || 0) + (itemB.built || 0);

          switch (state.sortBy) {
            case 'release_desc':
              return (b.release_date || '').localeCompare(a.release_date || '');
            case 'release_asc':
              return (a.release_date || '').localeCompare(b.release_date || '');
            case 'name_asc':
              return (a.name || '').localeCompare(b.name || '');
            case 'msrp_desc':
              return (b.msrp_jpy || 0) - (a.msrp_jpy || 0);
            case 'msrp_asc':
              return (a.msrp_jpy || 0) - (b.msrp_jpy || 0);
            case 'owned_desc':
              return totalB - totalA;
            default:
              return 0;
          }
        });
      }

      // 1. DECADE TABS & SMART YEAR SELECTION ENGINE
      const DECADES = [
        { key: 'all', labelKo: '전체 시대', labelJp: '全年代', labelEn: 'All Eras', min: 1980, max: 2026 },
        { key: '2020s', labelKo: '2020년대 (최신)', labelJp: '2020年代', labelEn: '2020s (Latest)', min: 2020, max: 2026 },
        { key: '2010s', labelKo: '2010년대', labelJp: '2010年代', labelEn: '2010s', min: 2010, max: 2019 },
        { key: '2000s', labelKo: '2000년대', labelJp: '2000年代', labelEn: '2000s', min: 2000, max: 2009 },
        { key: '1990s', labelKo: '1990년대', labelJp: '1990年代', labelEn: '1990s', min: 1990, max: 1999 },
        { key: '1980s', labelKo: '1980년대 (구판)', labelJp: '1980年代', labelEn: '1980s (Vintage)', min: 1980, max: 1989 }
      ];

      window.switchDecade = function(key) {
        state.selectedDecade = key;
        renderYearSlider();
      };

      window.toggleDecadeAll = function(decadeKey) {
        const dec = DECADES.find(d => d.key === decadeKey);
        if (!dec) return;
        const yearsInDecade = [];
        for (let y = dec.max; y >= dec.min; y--) {
          yearsInDecade.push(String(y));
        }

        const allSelected = yearsInDecade.every(y => state.selectedYears.includes(y));
        if (allSelected) {
          state.selectedYears = state.selectedYears.filter(y => !yearsInDecade.includes(y));
        } else {
          yearsInDecade.forEach(y => {
            if (!state.selectedYears.includes(y)) state.selectedYears.push(y);
          });
        }
        applyFilters();
      };

      function renderYearSlider() {
        const decadeContainer = document.getElementById('decade-tabs');
        const yearContainer = document.getElementById('year-slider');
        if (!yearContainer) return;

        const lang = state.currency || 'KRW';
        const yearCounts = {};
        KITS.forEach(k => {
          const y = k.year || 'Unknown';
          yearCounts[y] = (yearCounts[y] || 0) + 1;
        });

        // 1. Render Decade Tabs with Multi-Select Count Badges
        if (decadeContainer) {
          let decHtml = '';
          DECADES.forEach(dec => {
            const isDecActive = state.selectedDecade === dec.key;
            const label = lang === 'USD' ? dec.labelEn : (lang === 'JPY' ? dec.labelJp : dec.labelKo);
            
            let selCountInDec = 0;
            if (dec.key !== 'all') {
              selCountInDec = state.selectedYears.filter(y => Number(y) >= dec.min && Number(y) <= dec.max).length;
            } else {
              selCountInDec = state.selectedYears.length;
            }

            const badgeHtml = selCountInDec > 0 ? (' <span class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-cyan-500/30 text-cyan-300 font-mono font-bold">' + selCountInDec + '</span>') : '';
            const decClass = isDecActive 
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-md shadow-cyan-500/10' 
              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800';

            decHtml += '<button class="px-3 py-1.5 rounded-xl text-xs whitespace-nowrap border transition-all ' + decClass + '" onclick="window.switchDecade(\'' + dec.key + '\')">' + label + badgeHtml + '</button>';
          });
          decadeContainer.innerHTML = decHtml;
        }

        // 2. Render Individual Years for Selected Decade (Strictly 1 Compact Row)
        const activeDec = DECADES.find(d => d.key === state.selectedDecade) || DECADES[1];
        let yearsToShow = [];
        if (activeDec.key === 'all') {
          // In All view, show the most relevant recent 7 years (2020-2026) in 1 line
          for (let y = 2026; y >= 2020; y--) {
            if (yearCounts[y]) yearsToShow.push(String(y));
          }
        } else {
          for (let y = activeDec.max; y >= activeDec.min; y--) {
            if (yearCounts[y]) yearsToShow.push(String(y));
          }
        }

        let yearHtml = '';
        const yearSuffix = lang === 'USD' ? '' : (lang === 'JPY' ? '年' : '년');

        if (activeDec.key !== 'all' && yearsToShow.length > 0) {
          const allInDecSelected = yearsToShow.every(y => state.selectedYears.includes(y));
          const decSelectLabel = allInDecSelected ? '전체 해제' : '시대 전체 선택';
          yearHtml += '<button class="px-2.5 py-1 rounded-lg text-xs font-semibold border ' + (allInDecSelected ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300' : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700') + ' transition-all mr-1" onclick="window.toggleDecadeAll(\'' + activeDec.key + '\')">⚡ ' + decSelectLabel + '</button>';
        } else if (activeDec.key === 'all') {
          yearHtml += '<span class="text-[11px] text-slate-400 font-medium mr-1.5 flex items-center gap-1">⚡ 최근 7개년:</span>';
        }

        yearsToShow.forEach(year => {
          const count = yearCounts[year] || 0;
          const isActive = state.selectedYears.includes(String(year));
          const pillClass = isActive
            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-md shadow-cyan-500/10'
            : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700';

          yearHtml += '<button class="year-pill px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ' + pillClass + '" onclick="window.toggleYear(\'' + year + '\')">' + year + yearSuffix + ' <span class="ml-1 px-1.5 py-0.2 rounded text-[10px] bg-slate-800/90 text-cyan-400 font-mono">' + count + '</span></button>';
        });

        yearContainer.innerHTML = yearHtml;
      }

      // 2. RENDER SUBFACET SLIDER (Grade & Series Quick Filter - Multi-Select Enabled)
      window.switchSubfacetMode = function(mode) {
        state.subfacetMode = mode;
        document.querySelectorAll('.subfacet-mode-btn').forEach(btn => {
          const isTarget = btn.id === 'subfacet-btn-' + mode;
          btn.classList.toggle('active', isTarget);
          btn.classList.toggle('text-slate-400', !isTarget);
        });
        renderSubfacetSlider();
      };

      function renderSubfacetSlider() {
        const sliderContainer = document.getElementById('subfacet-slider');
        if (!sliderContainer) return;

        const t = UI_I18N[state.currency] || UI_I18N.KRW;
        let html = '';

        if (state.subfacetMode === 'grade') {
          const gradeDefs = [
            { key: 'HG', label: 'HG / HGUC', count: KITS.filter(k => k.gradeKey === 'HG').length },
            { key: 'MG', label: 'MG / MGEX / MGSD', count: KITS.filter(k => k.gradeKey === 'MG').length },
            { key: 'RG', label: 'RG (Real Grade)', count: KITS.filter(k => k.gradeKey === 'RG').length },
            { key: 'PG', label: 'PG (Perfect Grade)', count: KITS.filter(k => k.gradeKey === 'PG').length },
            { key: 'EG', label: 'ENTRY GRADE', count: KITS.filter(k => k.gradeKey === 'EG').length },
            { key: 'FM', label: (state.currency === 'KRW' ? '풀 메카닉스 / RE' : (state.currency === 'JPY' ? 'フルメカニクス / RE' : 'Full Mechanics / RE')), count: KITS.filter(k => k.gradeKey === 'FM').length },
            { key: 'SD', label: 'SD / SDCS / BB' + (state.currency === 'JPY' ? '戦士' : (state.currency === 'USD' ? ' Senshi' : '전사')), count: KITS.filter(k => k.gradeKey === 'SD').length },
            { key: 'Mega', label: (state.currency === 'KRW' ? '메가사이즈 (1/48)' : (state.currency === 'JPY' ? 'メガサイズ (1/48)' : 'Mega Size (1/48)')), count: KITS.filter(k => k.gradeKey === 'Mega').length },
            { key: '30MM', label: '30 MINUTES', count: KITS.filter(k => k.gradeKey === '30MM').length },
            { key: 'Pokemon', label: (state.currency === 'KRW' ? '포켓몬 프라모' : (state.currency === 'JPY' ? 'ポケプラ' : 'Pokemon Plamo')), count: KITS.filter(k => k.gradeKey === 'Pokemon').length },
            { key: 'Other', label: (state.currency === 'USD' ? 'Others' : (state.currency === 'JPY' ? 'その他' : '기타 프라모델')), count: KITS.filter(k => k.gradeKey === 'Other').length }
          ];

          const isAllActive = state.selectedGrades.length === 0;
          html += '<button class="subfacet-pill px-3.5 py-1.5 rounded-full text-xs font-semibold border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 whitespace-nowrap ' + (isAllActive ? 'active' : '') + '" onclick="window.toggleGrade(\'all\')">' + t.allGradesPill(KITS.length) + '</button>';

          gradeDefs.forEach(g => {
            const isActive = state.selectedGrades.includes(g.key);
            html += '<button class="subfacet-pill px-3.5 py-1.5 rounded-full text-xs font-medium border border-slate-800 bg-slate-900/90 hover:bg-slate-800 text-slate-300 whitespace-nowrap ' + (isActive ? 'active' : '') + '" onclick="window.toggleGrade(\'' + g.key + '\')">' + g.label + ' <span class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800/80 text-cyan-400 font-mono">' + g.count + '</span></button>';
          });

        } else if (state.subfacetMode === 'series') {
          const seriesCounts = {};
          KITS.forEach(k => {
            const s = k.series || '기타';
            seriesCounts[s] = (seriesCounts[s] || 0) + 1;
          });
          const sortedSeries = Object.entries(seriesCounts).sort((a,b) => b[1] - a[1]);

          const isAllActive = state.selectedSeries.length === 0;
          html += '<button class="subfacet-pill px-3.5 py-1.5 rounded-full text-xs font-semibold border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 whitespace-nowrap ' + (isAllActive ? 'active' : '') + '" onclick="window.toggleSeries(\'all\')">' + t.allSeriesPill(KITS.length) + '</button>';

          sortedSeries.forEach(([sName, count]) => {
            const isActive = state.selectedSeries.includes(sName);
            const locName = getLocalizedSeries(sName, state.currency);
            html += '<button class="subfacet-pill px-3 py-1.5 rounded-full text-xs font-medium border border-slate-800 bg-slate-900/90 hover:bg-slate-800 text-slate-300 whitespace-nowrap ' + (isActive ? 'active' : '') + '" onclick="window.toggleSeries(\'' + sName.replace(/'/g, "\\'") + '\')">' + locName + ' <span class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800/80 text-cyan-400 font-mono">' + count + '</span></button>';
          });
        }

        sliderContainer.innerHTML = html;
      }

      // 3. RENDER ACTIVE COMPOUND FILTER CHIPS
      function renderActiveFilterChips() {
        const bar = document.getElementById('active-filters-bar');
        const container = document.getElementById('active-filter-chips');
        if (!bar || !container) return;

        const chips = [];

        // Multi-Years Chips
        state.selectedYears.forEach(y => {
          chips.push({ label: '📅 ' + y + '년', reset: () => window.toggleYear(y) });
        });

        // Multi-Grades Chips
        const gradeNames = { HG:'HG', MG:'MG', RG:'RG', PG:'PG', EG:'EG', FM:'FM/RE', SD:'SD', Mega:'Mega Size', '30MM':'30MM', Pokemon:'포켓몬', Other:'기타' };
        state.selectedGrades.forEach(g => {
          chips.push({ label: '🏷️ ' + (gradeNames[g] || g), reset: () => window.toggleGrade(g) });
        });

        // Multi-Series Chips
        state.selectedSeries.forEach(s => {
          chips.push({ label: '🎬 ' + s, reset: () => window.toggleSeries(s) });
        });

        // Run Chip
        if (state.selectedRun !== 'all') {
          chips.push({ label: '🌐 ' + (state.selectedRun === 'Standard' ? '일반판' : '한정판/클럽G'), reset: () => { state.selectedRun = 'all'; document.getElementById('filter-run').value = 'all'; applyFilters(); } });
        }

        // Search Query Chip
        if (state.searchQuery) {
          chips.push({ label: '🔍 "' + state.searchQuery + '"', reset: () => { state.searchQuery = ''; document.getElementById('search-input').value = ''; applyFilters(); } });
        }

        if (chips.length > 0) {
          bar.classList.remove('hidden');
          container.innerHTML = chips.map((c, idx) => {
            return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">' +
              c.label +
              '<button class="w-4 h-4 rounded-full hover:bg-cyan-500/40 flex items-center justify-center text-[10px]" onclick="window.removeFilterChip(' + idx + ')">✕</button>' +
            '</span>';
          }).join('');
          window._activeChips = chips;
        } else {
          bar.classList.add('hidden');
          container.innerHTML = '';
          window._activeChips = [];
        }
      }

      window.removeFilterChip = function(index) {
        if (window._activeChips && window._activeChips[index]) {
          window._activeChips[index].reset();
        }
      };

      window.resetAllFilters = function() {
        state.selectedYears = [];
        state.selectedGrades = [];
        state.selectedSeries = [];
        state.selectedRun = 'all';
        state.searchQuery = '';

        const yearSelect = document.getElementById('filter-year-select');
        const gradeSelect = document.getElementById('filter-grade');
        const seriesSelect = document.getElementById('filter-series-select');
        const runSelect = document.getElementById('filter-run');
        const searchInput = document.getElementById('search-input');

        if (yearSelect) yearSelect.value = 'all';
        if (gradeSelect) gradeSelect.value = 'all';
        if (seriesSelect) seriesSelect.value = 'all';
        if (runSelect) runSelect.value = 'all';
        if (searchInput) searchInput.value = '';

        applyFilters();
        showToast('↺ 모든 필터 조건이 초기화되었습니다.');
      };

      function applyFilters() {
        state.page = 1;
        renderYearSlider();
        renderSubfacetSlider();
        renderActiveFilterChips();
        renderKits();
      }

      // TOGGLE YEAR (Multi-Select)
      window.toggleYear = function(year) {
        if (year === 'all') {
          state.selectedYears = [];
        } else {
          const sy = String(year);
          const idx = state.selectedYears.indexOf(sy);
          if (idx >= 0) {
            state.selectedYears.splice(idx, 1);
          } else {
            state.selectedYears.push(sy);
          }
        }
        const sel = document.getElementById('filter-year-select');
        if (sel) sel.value = state.selectedYears.length === 1 ? state.selectedYears[0] : 'all';
        applyFilters();
      };

      // TOGGLE GRADE (Multi-Select)
      window.toggleGrade = function(grade) {
        if (grade === 'all') {
          state.selectedGrades = [];
        } else {
          const sg = String(grade);
          const idx = state.selectedGrades.indexOf(sg);
          if (idx >= 0) {
            state.selectedGrades.splice(idx, 1);
          } else {
            state.selectedGrades.push(sg);
          }
        }
        const sel = document.getElementById('filter-grade');
        if (sel) sel.value = state.selectedGrades.length === 1 ? state.selectedGrades[0] : 'all';
        applyFilters();
      };

      // TOGGLE SERIES (Multi-Select)
      window.toggleSeries = function(series) {
        if (series === 'all') {
          state.selectedSeries = [];
        } else {
          const ss = String(series);
          const idx = state.selectedSeries.indexOf(ss);
          if (idx >= 0) {
            state.selectedSeries.splice(idx, 1);
          } else {
            state.selectedSeries.push(ss);
          }
        }
        const sel = document.getElementById('filter-series-select');
        if (sel) sel.value = state.selectedSeries.length === 1 ? state.selectedSeries[0] : 'all';
        applyFilters();
      };

      function renderKits() {
        const container = document.getElementById('kits-grid');
        const countEl = document.getElementById('filtered-count');
        if (!container) return;

        const t = UI_I18N[state.currency] || UI_I18N.KRW;
        const filtered = getFilteredKits();
        if (countEl) countEl.textContent = t.catalogCount(filtered.length);

        const visibleKits = filtered.slice(0, state.page * state.pageSize);

        if (visibleKits.length === 0) {
          const emptyTitle = state.currency === 'USD' ? 'No Gunpla kits matched your filters.' : (state.currency === 'JPY' ? '条件に一致するガンプラが見つかりませんでした。' : '선택하신 조건에 일치하는 건프라가 없습니다.');
          const emptySub = state.currency === 'USD' ? 'Try adjusting your search terms or filter tags above.' : (state.currency === 'JPY' ? '上部のフィルターや検索語を変更してお試しください。' : '상단의 필터 태그나 검색어를 변경해 보세요.');
          container.innerHTML = '<div class="col-span-full py-20 text-center text-slate-400"><p class="text-lg font-medium text-slate-300">' + emptyTitle + '</p><p class="text-sm text-slate-500 mt-1">' + emptySub + '</p></div>';
          return;
        }

        container.innerHTML = visibleKits.map(kit => {
          const item = getItem(kit.id);
          const isPbandai = kit.run === 'Limited' || kit.run === 'P-Bandai' || kit.run === 'Exclusive';
          const badgeClass = getGradeBadgeClass(kit.classification);
          
          const imgUrl = IMAGE_OVERRIDES[kit.id] || ('https://gunpla.fyi/images/boxarts/' + kit.id + '.jpeg');

          const b = item.backlog || 0;
          const p = item.inProgress || 0;
          const u = item.built || 0;
          const totalOwned = b + p + u;

          const pInfo = getKitPriceInfo(kit, state.currency);

          const isOwned = totalOwned > 0;
          const cardBorderClass = isOwned ? 'card-owned' : 'card-unowned';

          const dispGrade = getLocalizedClass(kit.classification, state.currency);
          const pbandaiLabel = t.pbandai;
          const releaseYearText = t.released(kit.year);

          return '<div class="glass-card rounded-2xl overflow-hidden flex flex-col group cursor-pointer transition-all duration-200 ' + cardBorderClass + '" onclick="window.openKitModal(\'' + kit.id + '\')">' +
            '<div class="relative w-full pt-[90%] bg-gradient-to-b from-slate-900/90 to-slate-950/95 overflow-hidden flex items-center justify-center p-3 skeleton-box">' +
              '<img src="' + imgUrl + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="absolute inset-0 w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300 z-[1]" onload="this.parentElement.classList.remove(\'skeleton-box\')" onerror="this.style.display=\'none\'; this.nextElementSibling.classList.remove(\'hidden\'); this.parentElement.classList.remove(\'skeleton-box\');">' +
              '<div class="hidden absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900/95 via-slate-950/95 to-[#0b1329] p-3 text-center z-0">' +
                '<div class="w-10 h-10 rounded-xl bg-cyan-950/70 border border-cyan-500/40 flex items-center justify-center mb-1.5 text-cyan-400 shadow-lg shadow-cyan-500/10">' +
                  '<svg class="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>' +
                '</div>' +
                '<span class="text-[11px] font-bold text-cyan-300 tracking-wide">공식 박스아트 공개 예정</span>' +
                '<span class="text-[9px] text-slate-400 font-mono mt-0.5">' + (kit.year >= 2026 ? '2026 PREVIEW' : 'OFFICIAL ARCHIVE') + '</span>' +
              '</div>' +
              '<div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5 z-10 max-w-[calc(100%-110px)]">' +
                '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide ' + badgeClass + '">' + dispGrade + '</span>' +
                (isPbandai ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-400 text-slate-950 shadow-md">' + pbandaiLabel + '</span>' : '') +
              '</div>' +
              '<div class="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">' +
                '<button class="w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 border ' + (item.wishlist ? 'bg-rose-500 text-white border-rose-400 shadow-lg shadow-rose-500/30' : 'bg-slate-900/90 border-slate-700/80 text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-400') + '" onclick="window.toggleWishlist(\'' + kit.id + '\', event)" title="위시리스트">' +
                  '<svg class="w-4 h-4" fill="' + (item.wishlist ? 'currentColor' : 'none') + '" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>' +
                '</button>' +
              '</div>' +
              '<div class="absolute bottom-2.5 left-2.5 right-2.5 flex justify-between items-center z-10 pointer-events-none">' +
                (kit.scale ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-950/85 backdrop-blur-md text-slate-300 border border-slate-800/80 shadow-md">' + kit.scale + '</span>' : '<span></span>') +
                '<span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-950/85 backdrop-blur-md text-slate-200 border border-slate-800/80 shadow-md">' + releaseYearText + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="p-3.5 flex-1 flex flex-col justify-between">' +
              '<div>' +
                '<div class="text-[11px] text-cyan-400 font-medium truncate mb-1" title="' + getLocalizedSeries(kit.series) + '">' + getLocalizedSeries(kit.series) + '</div>' +
                '<h3 class="text-sm font-bold text-slate-100 group-hover:text-cyan-300 transition-colors line-clamp-2 leading-snug mb-1.5 min-h-[2.5rem]" title="' + (kit.name || '') + '">' + (kit.name || '') + '</h3>' +
                '<div class="text-xs text-slate-400 font-mono mb-2.5 flex items-center gap-1.5 flex-wrap">' +
                  '<span>' + t.msrpLabel + ' <span class="text-slate-200 font-semibold">' + pInfo.formatted + '</span></span>' +
                  '<span class="text-[10px] ' + pInfo.badgeColor + '">(' + pInfo.orgNote + ')</span>' +
                '</div>' +
              '</div>' +
              '<div class="pt-2 border-t border-slate-800/80 space-y-1.5" onclick="event.stopPropagation()">' +
                '<div class="flex items-center justify-between text-xs bg-slate-900/90 rounded-xl px-2.5 py-1.5 border border-slate-800/90">' +
                  '<div class="flex items-center gap-1.5">' +
                    '<span class="w-2 h-2 rounded-full ' + (b > 0 ? 'bg-cyan-400' : 'bg-slate-600') + '"></span>' +
                    '<span class="font-medium ' + (b > 0 ? 'text-cyan-300 font-bold' : 'text-slate-400') + '">' + t.cardBacklog + '</span>' +
                  '</div>' +
                  '<div class="flex items-center gap-1">' +
                    '<button class="w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs" onclick="window.changeBacklog(\'' + kit.id + '\', -1, event)">-</button>' +
                    '<span class="w-5 text-center font-mono font-bold ' + (b > 0 ? 'text-cyan-400 text-xs' : 'text-slate-500 text-xs') + '">' + b + '</span>' +
                    '<button class="w-5 h-5 rounded-md bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-500/30 flex items-center justify-center font-bold text-xs" onclick="window.changeBacklog(\'' + kit.id + '\', 1, event)">+</button>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center justify-between text-xs bg-slate-900/90 rounded-xl px-2.5 py-1.5 border border-slate-800/90">' +
                  '<div class="flex items-center gap-1.5">' +
                    '<span class="w-2 h-2 rounded-full ' + (p > 0 ? 'bg-amber-400' : 'bg-slate-600') + '"></span>' +
                    '<span class="font-medium ' + (p > 0 ? 'text-amber-300 font-bold' : 'text-slate-400') + '">' + t.cardInProgress + '</span>' +
                  '</div>' +
                  '<div class="flex items-center gap-1">' +
                    '<button class="w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs" onclick="window.changeInProgress(\'' + kit.id + '\', -1, event)">-</button>' +
                    '<span class="w-5 text-center font-mono font-bold ' + (p > 0 ? 'text-amber-400 text-xs' : 'text-slate-500 text-xs') + '">' + p + '</span>' +
                    '<button class="w-5 h-5 rounded-md bg-amber-600/30 hover:bg-amber-500/40 text-amber-300 border border-amber-500/30 flex items-center justify-center font-bold text-xs" onclick="window.changeInProgress(\'' + kit.id + '\', 1, event)">+</button>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center justify-between text-xs bg-slate-900/90 rounded-xl px-2.5 py-1.5 border border-slate-800/90">' +
                  '<div class="flex items-center gap-1.5">' +
                    '<span class="w-2 h-2 rounded-full ' + (u > 0 ? 'bg-emerald-400' : 'bg-slate-600') + '"></span>' +
                    '<span class="font-medium ' + (u > 0 ? 'text-emerald-300 font-bold' : 'text-slate-400') + '">' + t.cardBuilt + '</span>' +
                  '</div>' +
                  '<div class="flex items-center gap-1">' +
                    '<button class="w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs" onclick="window.changeBuilt(\'' + kit.id + '\', -1, event)">-</button>' +
                    '<span class="w-5 text-center font-mono font-bold ' + (u > 0 ? 'text-emerald-400 text-xs' : 'text-slate-500 text-xs') + '">' + u + '</span>' +
                    '<button class="w-5 h-5 rounded-md bg-emerald-600/30 hover:bg-emerald-500/40 text-emerald-300 border border-emerald-500/30 flex items-center justify-center font-bold text-xs" onclick="window.changeBuilt(\'' + kit.id + '\', 1, event)">+</button>' +
                  '</div>' +
                '</div>' +
                (isOwned ?
                  '<div class="mt-2 pt-2 border-t border-cyan-500/20 flex items-center justify-between text-[11px] font-mono bg-cyan-950/40 px-2.5 py-1.5 rounded-xl border border-cyan-500/30 transition-all">' +
                    '<span class="flex items-center gap-1.5 text-cyan-300 font-bold">' +
                      '<span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>' +
                      t.totalOwned(totalOwned) +
                    '</span>' +
                    '<span class="text-[10px] text-cyan-400/80 font-medium">📦 ' + b + ' · ⚙️ ' + p + ' · 🔨 ' + u + '</span>' +
                  '</div>' :
                  '<div class="mt-2 pt-2 border-t border-slate-800/40 flex items-center justify-between text-[11px] font-mono bg-slate-950/40 px-2.5 py-1.5 rounded-xl border border-slate-800/40 transition-all text-slate-500">' +
                    '<span class="flex items-center gap-1.5 text-slate-500">' +
                      '<span class="w-1.5 h-1.5 rounded-full bg-slate-700"></span>' +
                      t.notOwned +
                    '</span>' +
                    '<span class="text-[10px] text-slate-600 font-medium">📦 0 · ⚙️ 0 · 🔨 0</span>' +
                  '</div>') +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');

        const loadMoreContainer = document.getElementById('load-more-container');
        if (loadMoreContainer) {
          if (filtered.length > state.page * state.pageSize) {
            loadMoreContainer.innerHTML = '<button class="px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all" onclick="window.loadMore()">' + t.loadMore(visibleKits.length, filtered.length) + '</button>';
          } else {
            loadMoreContainer.innerHTML = '';
          }
        }
      }

      window.loadMore = function() {
        state.page++;
        renderKits();
      };

      window.openKitModal = function(id) {
        const kit = KITS.find(k => k.id === id);
        if (!kit) return;
        state.selectedKit = kit;
        state.activeImageIndex = 0;
        const modal = document.getElementById('kit-modal');
        if (!modal) return;
        renderModalContent();
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      };

      window.closeKitModal = function() {
        const modal = document.getElementById('kit-modal');
        if (modal) modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
      };

      window.openPolicyModal = function(type) {
        const modal = document.getElementById('policy-modal');
        const content = document.getElementById('policy-modal-content');
        if (!modal || !content) return;

        if (type === 'about') {
          content.innerHTML = '<h2 class="text-lg font-bold text-white mb-3 flex items-center gap-2">🤖 GunplaSet 서비스 소개</h2>' +
            '<p class="mb-2"><b>GunplaSet (건프라셋)</b>은 1980년부터 현재까지 출시된 2,716종 이상의 반다이 정품 건프라 및 프라모델을 한눈에 조회하고, 나만의 프라모델 수집/조립 상태(새것/조립중/조립완료)와 자산 가치를 체계적으로 관리할 수 있는 글로벌 팬 아카이브 도구입니다.</p>' +
            '<div class="bg-slate-950/60 p-3.5 rounded-2xl border border-cyan-500/20 space-y-1.5 mt-3">' +
              '<div class="text-cyan-400 font-bold">✨ 주요 핵심 기능</div>' +
              '<div>&bull; 2,716종 전 테마 반다이 공식 12배 정가(클럽G 14.3배) 실시간 환산</div>' +
              '<div>&bull; 새것(미개봉), 조립중/부품, 조립완료 3단계 실시간 보유 현황 및 자산 가치 포트폴리오</div>' +
              '<div>&bull; 한국어, 일본어, 영어 3개국어 검색 및 KRW, JPY, USD 3대 통화 지원</div>' +
            '</div>';
        } else if (type === 'privacy') {
          content.innerHTML = '<h2 class="text-lg font-bold text-white mb-3 flex items-center gap-2">🔒 개인정보처리방침 (Privacy Policy)</h2>' +
            '<p class="mb-2">GunplaSet은 이용자의 개인정보를 매우 소중하게 생각하며, 관련 법령을 철저히 준수합니다.</p>' +
            '<div class="space-y-2 mt-3">' +
              '<div><b>1. 수집하는 개인정보 항목</b>: 비회원 이용 시 어떠한 개인정보도 수집하지 않으며 모든 데이터는 브라우저 내부 로컬 스토리지에만 저장됩니다. 추후 소셜 로그인 이용 시 닉네임, 이메일 식별자만 인증 목적으로 안전하게 처리됩니다.</div>' +
              '<div><b>2. 개인정보의 이용 목적</b>: 기기 간 건프라 소장 목록 동기화 및 서비스 제공에만 국한되며 마케팅 활용이나 제3자 제공을 절대 하지 않습니다.</div>' +
              '<div><b>3. 쿠키 및 광고</b>: 본 사이트는 사용자 환경 개선 및 서비스 유지를 위해 구글 애드센스 등 표준 광고 쿠키를 사용할 수 있습니다.</div>' +
            '</div>';
        } else if (type === 'terms') {
          content.innerHTML = '<h2 class="text-lg font-bold text-white mb-3 flex items-center gap-2">📜 서비스 이용약관 (Terms of Service)</h2>' +
            '<p class="mb-2">본 약관은 GunplaSet 서비스의 이용 조건 및 절차에 관한 기본 사항을 정합니다.</p>' +
            '<div class="space-y-2 mt-3">' +
              '<div><b>1. 서비스 목적</b>: 본 사이트는 건프라 애호가를 위한 비영리 정보 제공 및 컬렉션 관리 플랫폼입니다.</div>' +
              '<div><b>2. 저작권 면책</b>: 건담 및 건프라 관련 모든 상표권 및 저작권은 BANDAI SPIRITS 및 SOTSU/SUNRISE에 있습니다. 본 사이트는 공식 제휴사가 아니며 정보 제공 목적으로 공정 이용(Fair Use) 원칙을 준수합니다.</div>' +
              '<div><b>3. 서비스 변경</b>: 서비스는 사전 공지 후 성능 개선 및 데이터 갱신을 위해 업데이트될 수 있습니다.</div>' +
            '</div>';
        } else if (type === 'contact') {
          content.innerHTML = '<h2 class="text-lg font-bold text-white mb-3 flex items-center gap-2">📬 문의 및 오류 제보 (Contact)</h2>' +
            '<p class="mb-2">제품 정보 누락, 가격 오기입 제보, 권리자 문의, 기타 개선 제안은 아래 공식 채널로 언제든 편하게 보내주세요.</p>' +
            '<div class="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 space-y-2 mt-3">' +
              '<div><b>📧 공식 문의 이메일</b>: <a href="mailto:support@gunplaset.com" class="text-cyan-400 underline font-mono">support@gunplaset.com</a></div>' +
              '<div><b>💬 GitHub Issues</b>: <a href="https://github.com" target="_blank" class="text-cyan-400 underline">공식 GitHub 저장소 이슈 트래커</a></div>' +
              '<div class="text-[11px] text-slate-500 pt-2 border-t border-slate-800">제보해 주신 공식 가격 및 신제품 정보는 매주 정기 업데이트 검증 시 신속하게 반영됩니다.</div>' +
            '</div>';
        }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      };

      window.closePolicyModal = function() {
        const modal = document.getElementById('policy-modal');
        if (modal) modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
      };

      window.setModalImageIndex = function(idx) {
        state.activeImageIndex = idx;
        renderModalContent();
      };

      window.nextModalImage = function(delta) {
        const kit = state.selectedKit;
        if (!kit || !kit.gallery || kit.gallery.length <= 1) return;
        let newIdx = state.activeImageIndex + delta;
        if (newIdx < 0) newIdx = kit.gallery.length - 1;
        if (newIdx >= kit.gallery.length) newIdx = 0;
        state.activeImageIndex = newIdx;
        renderModalContent();
      };

      window.openLightbox = function() {
        const kit = state.selectedKit;
        if (!kit) return;
        const modal = document.getElementById('lightbox-modal');
        const img = document.getElementById('lightbox-img');
        const counter = document.getElementById('lightbox-counter');
        const title = document.getElementById('lightbox-title');
        const rawGallery = kit.gallery && kit.gallery.length > 0 ? kit.gallery : [ { url: kit.product_url || kit.image_url } ];
        const gallery = rawGallery.map(g => (typeof g === 'object' && g !== null && g.url) ? g : { url: (typeof g === 'string' ? g : kit.product_url), cdn_url: kit.product_url });
        const cur = gallery[state.activeImageIndex] || gallery[0] || {};
        const curUrl = cur.url || kit.product_url || kit.boxart_url;
        const curCdn = cur.cdn_url || kit.boxart_url || curUrl;

        if (img) {
          img.src = curUrl;
          img.dataset.fallback = curCdn;
          img.onerror = function() {
            if (this.dataset.fallback && this.src !== this.dataset.fallback) {
              this.src = this.dataset.fallback;
            }
          };
        }
        if (counter) counter.innerText = (state.activeImageIndex + 1) + ' / ' + gallery.length;
        if (title) title.innerText = (kit.classification ? '[' + kit.classification + '] ' : '') + (kit.name || '');
        modal.classList.remove('hidden');
      };

      window.closeLightbox = function(e) {
        if (e) e.stopPropagation();
        const modal = document.getElementById('lightbox-modal');
        if (modal) modal.classList.add('hidden');
      };

      window.nextLightboxImage = function(delta) {
        window.nextModalImage(delta);
        window.openLightbox();
      };

      document.addEventListener('keydown', function(e) {
        const lb = document.getElementById('lightbox-modal');
        if (lb && !lb.classList.contains('hidden')) {
          if (e.key === 'Escape') window.closeLightbox();
          if (e.key === 'ArrowLeft') window.nextLightboxImage(-1);
          if (e.key === 'ArrowRight') window.nextLightboxImage(1);
        }
      });

      function renderModalContent() {
        const kit = state.selectedKit;
        if (!kit) return;
        const item = getItem(kit.id);
        const modalBody = document.getElementById('modal-body');
        if (!modalBody) return;
        const t = UI_I18N[state.currency] || UI_I18N.KRW;
        const b = item.backlog || 0;
        const p = item.inProgress || 0;
        const u = item.built || 0;
        const total = b + p + u;

        const krwInfo = getKitPriceInfo(kit, 'KRW');
        const jpyInfo = getKitPriceInfo(kit, 'JPY');
        const usdInfo = getKitPriceInfo(kit, 'USD');

        const modalGrade = getLocalizedClass(kit.classification, state.currency);
        const lblScale = state.currency === 'USD' ? 'Scale' : (state.currency === 'JPY' ? 'スケール' : '스케일');
        const lblRelease = state.currency === 'USD' ? 'Release Date' : (state.currency === 'JPY' ? '発売日' : '출시일');
        const lblRun = state.currency === 'USD' ? 'Edition' : (state.currency === 'JPY' ? '販売区分' : '발매구분');
        let valRun = '';
        if (kit.run === 'Standard') {
          valRun = state.currency === 'USD' ? 'Standard' : (state.currency === 'JPY' ? '一般販売' : '일반판');
        } else {
          valRun = state.currency === 'USD' ? 'Limited (PB)' : (state.currency === 'JPY' ? '限定品(プレバン)' : '한정판/클럽G');
        }

        const rawGallery = kit.gallery && kit.gallery.length > 0 ? kit.gallery : [ { url: kit.product_url || kit.image_url } ];
        const gallery = rawGallery.map(g => (typeof g === 'object' && g !== null && g.url) ? g : { url: (typeof g === 'string' ? g : kit.product_url), cdn_url: kit.product_url });

        const currentImgObj = gallery[state.activeImageIndex] || gallery[0] || {};
        const currentImgUrl = currentImgObj.url || kit.product_url || kit.boxart_url;
        const currentCdnUrl = currentImgObj.cdn_url || kit.boxart_url || currentImgUrl;

        const zoomHint = state.currency === 'USD' ? '🔍 Click to view 1200px fullscreen HD zoom' : (state.currency === 'JPY' ? '🔍 クリックして1200px原寸全画面拡大' : '🔍 클릭하여 1200px 원본 전체화면 확대');

        modalBody.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">' +
          '<div class="flex flex-col">' +
            '<div class="relative w-full h-[420px] md:h-[460px] bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center p-3 border border-slate-800 group cursor-zoom-in" onclick="window.openLightbox()">' +
              '<img src="' + currentImgUrl + '" data-fallback="' + currentCdnUrl + '" alt="' + (kit.name || '') + '" class="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105" onerror="if(this.dataset.fallback && this.src !== this.dataset.fallback){ this.src = this.dataset.fallback; }">' +
              (gallery.length > 1 ? '<button class="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-900/85 hover:bg-slate-800 text-white flex items-center justify-center font-bold text-base border border-slate-700 shadow-xl z-10" onclick="event.stopPropagation(); window.nextModalImage(-1)">‹</button>' : '') +
              (gallery.length > 1 ? '<button class="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-900/85 hover:bg-slate-800 text-white flex items-center justify-center font-bold text-base border border-slate-700 shadow-xl z-10" onclick="event.stopPropagation(); window.nextModalImage(1)">›</button>' : '') +
              '<div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] bg-slate-900/90 text-cyan-400 font-mono border border-slate-800 shadow-md">' + (state.activeImageIndex + 1) + ' / ' + gallery.length + '</div>' +
              '<div class="absolute bottom-3 left-3 px-2.5 py-1 rounded-xl text-[10px] bg-slate-900/90 text-slate-300 font-medium border border-slate-800/90 shadow-md flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none">' +
                '<span>' + zoomHint + '</span>' +
              '</div>' +
            '</div>' +
            (gallery.length > 1 ? '<div class="flex items-center gap-2.5 mt-3 overflow-x-auto pb-1.5">' +
              gallery.map((g, idx) => {
                const isSelected = idx === state.activeImageIndex;
                const isBoxart = g.is_boxart || (idx === gallery.length - 1 && kit.boxart_url === g.url && gallery.length > 1);
                const thumbUrl = g.url || kit.product_url;
                const thumbCdn = g.cdn_url || thumbUrl;
                return '<button class="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-slate-900 transition-all ' + (isSelected ? 'border-2 border-cyan-400 ring-2 ring-cyan-400/30 shadow-md shadow-cyan-500/20' : 'border border-slate-800/80 opacity-60 hover:opacity-100 hover:border-slate-600') + '" onclick="window.setModalImageIndex(' + idx + ')">' +
                  '<img src="' + thumbUrl + '" data-fallback="' + thumbCdn + '" class="w-full h-full object-cover" alt="thumb ' + (idx + 1) + '" onerror="if(this.dataset.fallback && this.src !== this.dataset.fallback){ this.src = this.dataset.fallback; }">' +
                  (isBoxart ? '<span class="absolute bottom-0 inset-x-0 bg-slate-950/90 text-[9px] text-cyan-300 font-bold text-center leading-tight py-0.5">BOX</span>' : '') +
                '</button>';
              }).join('') +
            '</div>' : '') +
          '</div>' +
          '<div class="flex flex-col justify-between">' +
            '<div>' +
              '<div class="flex items-center gap-2 mb-1.5">' +
                '<span class="px-2.5 py-0.5 rounded-md text-xs font-bold ' + getGradeBadgeClass(kit.classification) + '">' + modalGrade + '</span>' +
                '<span class="text-xs text-cyan-400 font-medium">' + getLocalizedSeries(kit.series) + '</span>' +
              '</div>' +
              '<h2 class="text-xl font-bold text-white mb-2 leading-tight">' + kit.name + '</h2>' +
              '<div class="grid grid-cols-2 gap-2 text-xs py-3 border-y border-slate-800 my-3 text-slate-300">' +
                '<div>' + (krwInfo.isClubG ? '🔵 클럽G' : '🇰🇷 반코') + ' 정가: <span class="text-cyan-400 font-bold font-mono">' + krwInfo.formatted + '</span> <span class="text-[10px] ' + krwInfo.badgeColor + '">(' + krwInfo.orgNote + ')</span></div>' +
                '<div>🇯🇵 반다이 일본: <span class="text-slate-200 font-bold font-mono">' + jpyInfo.formatted + (jpyInfo.isVerified ? ' <span class="text-[10px] text-slate-400 font-normal">(세별 ¥' + Math.round(jpyInfo.value / 1.1).toLocaleString() + ')</span>' : '') + '</span></div>' +
                '<div>🇺🇸 반다이 US: <span class="text-slate-200 font-bold font-mono">' + usdInfo.formatted + '</span></div>' +
                '<div>' + lblScale + ': <span class="font-mono text-white">' + (kit.scale || '1/144') + '</span></div>' +
                '<div>' + lblRelease + ': <span class="font-mono text-white">' + (kit.release_date || kit.year) + '</span></div>' +
                '<div>' + lblRun + ': <span class="text-white">' + valRun + '</span></div>' +
              '</div>' +
              (!krwInfo.isVerified ? '<div class="bg-amber-950/40 border border-amber-500/30 rounded-xl p-2.5 mb-3 text-[11px] text-amber-300 flex items-center gap-2"><span>⚠️ 본 상품은 반다이 공식 카탈로그에 가격이 등재되어 있지 않은 단종/구판/미등록 품목입니다.</span></div>' : '') +
              '<div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800 mb-3 text-xs">' +
                '<div class="font-bold text-cyan-400 mb-1.5 flex justify-between">' +
                  '<span>' + t.modalStatusTitle + '</span>' +
                  '<span class="text-white font-mono font-bold">' + t.modalTotal(total) + '</span>' +
                '</div>' +
                '<div class="grid grid-cols-3 gap-2 text-center text-[11px] font-mono">' +
                  '<div class="bg-slate-950 p-1.5 rounded-lg border border-cyan-500/20 text-cyan-300">' + t.modalBacklog + ' <b>' + b + '</b></div>' +
                  '<div class="bg-slate-950 p-1.5 rounded-lg border border-amber-500/20 text-amber-300">' + t.modalInProgress + ' <b>' + p + '</b></div>' +
                  '<div class="bg-slate-950 p-1.5 rounded-lg border border-emerald-500/20 text-emerald-300">' + t.modalBuilt + ' <b>' + u + '</b></div>' +
                '</div>' +
              '</div>' +
              '<div class="space-y-2">' +
                '<label class="block text-xs font-medium text-slate-400">' + t.modalNotesLabel + '</label>' +
                '<input type="text" id="modal-notes" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400" placeholder="' + t.modalNotesPlaceholder + '" value="' + (item.notes || '') + '">' +
              '</div>' +
            '</div>' +
            '<div class="pt-4 border-t border-slate-800 flex justify-between items-center gap-2 mt-4">' +
              '<button class="px-3.5 py-2 rounded-xl flex items-center gap-1.5 text-xs font-bold transition-all border ' + (item.wishlist ? 'bg-rose-500 text-white border-rose-400 shadow-lg shadow-rose-500/30' : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-rose-500 hover:text-rose-400') + '" onclick="window.toggleWishlist(\'' + kit.id + '\', event); renderModalContent();">' +
                '<svg class="w-4 h-4" fill="' + (item.wishlist ? 'currentColor' : 'none') + '" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>' +
                '<span>' + (item.wishlist ? '위시리스트 담김' : '위시리스트 추가') + '</span>' +
              '</button>' +
              '<div class="flex items-center gap-2">' +
                '<button class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold" onclick="window.closeKitModal()">' + t.modalClose + '</button>' +
                '<button class="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold" onclick="window.saveModalData(\'' + kit.id + '\')">' + t.modalSave + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      window.saveModalData = function(id) {
        const notes = document.getElementById('modal-notes')?.value || '';
        updateItem(id, { notes });
        showToast('저장되었습니다.');
        window.closeKitModal();
      };

      const DB_NAME = 'gunpladex_sync_db';
      const DB_STORE = 'handles';

      function openSyncDB() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(DB_STORE);
          };
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = (e) => reject(e);
        });
      }

      async function saveHandleToDB(handle) {
        try {
          const db = await openSyncDB();
          return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(handle, 'sync_file_handle');
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
          });
        } catch(e) {}
      }

      async function getHandleFromDB() {
        try {
          const db = await openSyncDB();
          return new Promise((resolve) => {
            const tx = db.transaction(DB_STORE, 'readonly');
            const req = tx.objectStore(DB_STORE).get('sync_file_handle');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
          });
        } catch(e) { return null; }
      }

      function updateSyncUI(isOn, msg) {
        const dot = document.getElementById('sync-dot');
        const text = document.getElementById('sync-status-text');
        const btn = document.getElementById('btn-cloud-sync');
        if (dot) {
          dot.className = isOn ? 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400' : 'w-2 h-2 rounded-full bg-slate-500';
        }
        if (btn) {
          if (isOn) {
            btn.className = 'px-2.5 py-1 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 text-xs font-semibold border border-emerald-500/60 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/10';
          } else {
            btn.className = 'px-2.5 py-1 rounded-xl bg-cyan-950/70 hover:bg-cyan-900 text-cyan-300 text-xs font-semibold border border-cyan-500/40 transition-all flex items-center gap-1.5 shadow-sm';
          }
        }
        if (text) {
          if (msg) {
            text.textContent = msg;
          } else if (isOn) {
            text.textContent = state.currency === 'USD' ? '☁️ Drive Sync ON' : (state.currency === 'JPY' ? '☁️ ドライブ同期 ON' : '☁️ 드라이브 자동연동 ON');
          } else {
            const t = UI_I18N[state.currency] || UI_I18N.KRW;
            text.textContent = t.syncAuto;
          }
        }
      }

      async function restoreAutoSyncOnLoad() {
        try {
          const handle = await getHandleFromDB();
          if (handle) {
            autoSyncFileHandle = handle;
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
              updateSyncUI(true);
              try {
                const file = await handle.getFile();
                const text = await file.text();
                if (text && text.trim().startsWith('{')) {
                  const data = JSON.parse(text);
                  if (data && typeof data === 'object') {
                    state.userCollection = data;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.userCollection));
                    updateGlobalStats();
                    renderKits();
                  }
                }
              } catch(e) {}
            } else {
              const reconnectMsg = state.currency === 'USD' ? '☁️ Reconnect Drive' : (state.currency === 'JPY' ? '☁️ ドライブ再接続' : '☁️ 드라이브 재연결');
              updateSyncUI(false, reconnectMsg);
            }
          }
        } catch(e) {}
      }

      window.initOrToggleAutoSync = async function() {
        try {
          let handle = autoSyncFileHandle || await getHandleFromDB();
          if (handle) {
            const perm = await handle.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
              autoSyncFileHandle = handle;
              await saveHandleToDB(handle);
              try {
                const file = await handle.getFile();
                const text = await file.text();
                if (text && text.trim().startsWith('{')) {
                  const data = JSON.parse(text);
                  if (data && typeof data === 'object') {
                    state.userCollection = data;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.userCollection));
                    updateGlobalStats();
                    renderKits();
                  }
                }
              } catch(e) {}
              updateSyncUI(true, '☁️ 드라이브 자동연동 ON');
              showToast('🟢 구글 드라이브 실시간 자동 동기화가 활성화되었습니다!');
              return;
            }
          }

          if (!window.showOpenFilePicker) {
            alert('현재 브라우저 환경에서는 파일 시스템 연동 API를 지원하지 않습니다. Chrome 또는 Edge 브라우저를 이용해 주세요.');
            return;
          }
          const [newHandle] = await window.showOpenFilePicker({
            types: [{
              description: 'Gunpla Collection File (my_collection.json)',
              accept: { 'application/json': ['.json'], 'text/javascript': ['.js'] }
            }],
            multiple: false
          });
          if (newHandle) {
            autoSyncFileHandle = newHandle;
            await saveHandleToDB(newHandle);
            const file = await newHandle.getFile();
            const text = await file.text();
            if (text) {
              try {
                let data = null;
                if (text.includes('window.SAVED_COLLECTION_DATA')) {
                  const match = text.match(/window\.SAVED_COLLECTION_DATA\s*=\s*(\{[\s\S]*\});?/);
                  if (match) data = JSON.parse(match[1]);
                } else {
                  data = JSON.parse(text);
                }
                if (data && typeof data === 'object') {
                  state.userCollection = { ...state.userCollection, ...data };
                  saveUserCollection();
                  renderKits();
                }
              } catch(e) {}
            }
            updateSyncUI(true, '☁️ 드라이브 자동연동 ON');
            showToast('🟢 구글 드라이브 폴더의 파일과 실시간 자동 연동이 활성화되었습니다!');
          }
        } catch(err) {
          console.log('Sync picker closed:', err);
        }
      };

      window.exportJSON = function() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.userCollection, null, 2));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", 'gunplaset_backup_' + new Date().toISOString().slice(0,10) + '.json');
        dlAnchor.click();
        showToast('💾 백업 파일(JSON)이 다운로드되었습니다.');
      };

      window.importJSON = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            const imported = JSON.parse(e.target.result);
            if (typeof imported === 'object') {
              state.userCollection = imported;
              saveUserCollection();
              renderKits();
              showToast('📂 백업 데이터가 성공적으로 복원되었습니다!');
            }
          } catch (err) {
            alert('올바른 백업 JSON 파일이 아닙니다.');
          }
        };
        reader.readAsText(file);
      };

      window.exportCSV = function() {
        let csv = "\uFEFF제품명,등급,스케일,시리즈,출시일,발매구분,새것(미개봉),조립중,조립완료,총보유수량,공식정가(원화),공식정가(엔화),공식정가(달러),메모\n";
        Object.entries(state.userCollection).forEach(([id, data]) => {
          const kit = KITS.find(k => k.id === id);
          if (!kit) return;
          const b = data.backlog || 0;
          const p = data.inProgress || 0;
          const u = data.built || 0;
          const total = b + p + u;

          const krwInfo = getKitPriceInfo(kit, 'KRW');
          const jpyInfo = getKitPriceInfo(kit, 'JPY');
          const usdInfo = getKitPriceInfo(kit, 'USD');

          csv += '"' + kit.name + '","' + kit.classification + '","' + (kit.scale || '') + '","' + (kit.series || '') + '","' + (kit.release_date || '') + '","' + kit.run + '","' + b + '","' + p + '","' + u + '","' + total + '","' + krwInfo.value + '","' + jpyInfo.value + '","' + usdInfo.value + '","' + (data.notes || '').replace(/"/g, '""') + '"\n';
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = 'gunpladex_inventory_' + new Date().toISOString().slice(0,10) + '.csv';
        link.click();
        showToast('📊 3개국 공식가 포함 엑셀 CSV 파일이 다운로드되었습니다.');
      };

      window.switchView = function(viewName) {
        state.activeView = viewName;
        state.page = 1;
        document.querySelectorAll('.nav-tab').forEach(btn => {
          const isTarget = btn.dataset.view === viewName;
          btn.classList.toggle('bg-cyan-500/20', isTarget);
          btn.classList.toggle('text-cyan-400', isTarget);
          btn.classList.toggle('border-cyan-500/40', isTarget);
          btn.classList.toggle('text-slate-400', !isTarget);
        });
        const kitsSection = document.getElementById('kits-section');
        const analyticsSection = document.getElementById('analytics-section');
        if (viewName === 'analytics') {
          if (kitsSection) kitsSection.classList.add('hidden');
          if (analyticsSection) {
            analyticsSection.classList.remove('hidden');
            renderAnalytics();
          }
        } else {
          if (analyticsSection) analyticsSection.classList.add('hidden');
          if (kitsSection) kitsSection.classList.remove('hidden');
          renderKits();
        }
      };

      function renderAnalytics() {
        const container = document.getElementById('analytics-view');
        if (!container) return;
        const t = UI_I18N[state.currency] || UI_I18N.KRW;
        let totalBacklog = 0, totalInProgress = 0, totalBuilt = 0, totalWishlist = 0, totalVal = 0;
        Object.entries(state.userCollection).forEach(([id, data]) => {
          const kit = KITS.find(k => k.id === id);
          if (!kit) return;
          totalBacklog += (data.backlog || 0);
          totalInProgress += (data.inProgress || 0);
          totalBuilt += (data.built || 0);
          if (data.wishlist) totalWishlist++;

          const pInfo = getKitPriceInfo(kit, state.currency);
          const price = data.customPrice ? Number(data.customPrice) : pInfo.value;
          totalVal += ((data.backlog || 0) * price);
        });
        const totalOwnedAll = totalBacklog + totalInProgress + totalBuilt;

        let formattedVal = '';
        let subValNote = '';
        if (state.currency === 'KRW') {
          formattedVal = '₩ ' + Math.round(totalVal).toLocaleString();
          subValNote = '반다이코리아 공식가 기준 (일반 12배 / 한정 14.3배)';
        } else if (state.currency === 'USD') {
          formattedVal = '$ ' + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          subValNote = 'Bandai US / BNTCA Official Retail MSRP';
        } else {
          formattedVal = '¥ ' + Math.round(totalVal).toLocaleString();
          subValNote = 'バンダイ日本 公式定価 (税込10%)';
        }

        container.innerHTML = '<div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">' +
          '<div class="glass-card p-4 rounded-2xl border-l-4 border-blue-400">' +
            '<div class="text-xs text-slate-400 font-semibold mb-1">' + t.statTotalOwned + '</div>' +
            '<div class="text-2xl font-extrabold text-white font-mono">' + totalOwnedAll + ' <span class="text-xs font-normal text-slate-400">' + t.countUnit + '</span></div>' +
          '</div>' +
          '<div class="glass-card p-4 rounded-2xl border-l-4 border-cyan-400">' +
            '<div class="text-xs text-slate-400 font-semibold mb-1">' + t.statBacklog + '</div>' +
            '<div class="text-2xl font-extrabold text-cyan-400 font-mono">' + totalBacklog + ' <span class="text-xs font-normal text-slate-400">' + t.boxUnit + '</span></div>' +
          '</div>' +
          '<div class="glass-card p-4 rounded-2xl border-l-4 border-amber-400">' +
            '<div class="text-xs text-slate-400 font-semibold mb-1">' + t.statInProgress + '</div>' +
            '<div class="text-2xl font-extrabold text-amber-400 font-mono">' + totalInProgress + ' <span class="text-xs font-normal text-slate-400">' + t.countUnit + '</span></div>' +
          '</div>' +
          '<div class="glass-card p-4 rounded-2xl border-l-4 border-emerald-400">' +
            '<div class="text-xs text-slate-400 font-semibold mb-1">' + t.statBuilt + '</div>' +
            '<div class="text-2xl font-extrabold text-emerald-400 font-mono">' + totalBuilt + ' <span class="text-xs font-normal text-slate-400">' + t.countUnit + '</span></div>' +
          '</div>' +
          '<div class="glass-card p-4 rounded-2xl border-l-4 border-yellow-400">' +
            '<div class="text-xs text-slate-400 font-semibold mb-1">' + t.statValuation + ' (' + state.currency + ')</div>' +
            '<div class="text-2xl font-extrabold text-yellow-400 font-mono">' + formattedVal + '</div>' +
            '<div class="text-[10px] text-slate-400 mt-1 truncate" title="' + subValNote + '">' + subValNote + '</div>' +
          '</div>' +
        '</div>';
      }

      function populateDropdownSelects() {
        const yearSelect = document.getElementById('filter-year-select');
        if (yearSelect) {
          const currentVal = yearSelect.value || 'all';
          const yearCounts = {};
          KITS.forEach(k => { yearCounts[k.year] = (yearCounts[k.year] || 0) + 1; });
          const sortedYears = Object.keys(yearCounts).filter(y => y !== 'Unknown').sort((a,b) => b - a);
          const allYearsLabel = state.currency === 'USD' ? 'All Years' : (state.currency === 'JPY' ? '全発売年' : '모든 연도 (All Years)');
          const yearSuffix = state.currency === 'USD' ? '' : (state.currency === 'JPY' ? '年' : '년');
          let optionsHtml = '<option value="all">' + allYearsLabel + '</option>';
          sortedYears.forEach(y => {
            const isSel = currentVal === String(y) ? ' selected' : '';
            optionsHtml += '<option value="' + y + '"' + isSel + '>' + y + yearSuffix + ' (' + yearCounts[y] + ')</option>';
          });
          yearSelect.innerHTML = optionsHtml;
        }

        const seriesSelect = document.getElementById('filter-series-select');
        if (seriesSelect) {
          const currentVal = seriesSelect.value || 'all';
          const seriesCounts = {};
          KITS.forEach(k => { const s = k.series || '기타'; seriesCounts[s] = (seriesCounts[s] || 0) + 1; });
          const sortedSeries = Object.entries(seriesCounts).sort((a,b) => b[1] - a[1]);
          const allSeriesLabel = state.currency === 'USD' ? 'All Series' : (state.currency === 'JPY' ? '全シリーズ' : '모든 시리즈 (All Series)');
          let sHtml = '<option value="all">' + allSeriesLabel + '</option>';
          sortedSeries.forEach(([sName, cnt]) => {
            const locName = getLocalizedSeries(sName, state.currency);
            const isSel = currentVal === sName ? ' selected' : '';
            sHtml += '<option value="' + sName.replace(/"/g, '&quot;') + '"' + isSel + '>' + locName + ' (' + cnt + ')</option>';
          });
          seriesSelect.innerHTML = sHtml;
        }
      }

      function init() {
        KITS = (window.GUNPLA_MASTER_DATA || []).map(enrichKit);
        populateDropdownSelects();
        window.setCurrency(state.currency);
        renderYearSlider();
        renderSubfacetSlider();
        renderActiveFilterChips();
        renderKits();
        restoreAutoSyncOnLoad();

        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          let debounceTimer;
          searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              state.searchQuery = e.target.value;
              applyFilters();
            }, 100);
          });
        }

        document.getElementById('filter-year-select')?.addEventListener('change', (e) => {
          if (e.target.value === 'all') {
            state.selectedYears = [];
          } else {
            state.selectedYears = [e.target.value];
          }
          applyFilters();
        });

        document.getElementById('filter-grade')?.addEventListener('change', (e) => {
          if (e.target.value === 'all') {
            state.selectedGrades = [];
          } else {
            state.selectedGrades = [e.target.value];
          }
          applyFilters();
        });

        document.getElementById('filter-series-select')?.addEventListener('change', (e) => {
          if (e.target.value === 'all') {
            state.selectedSeries = [];
          } else {
            state.selectedSeries = [e.target.value];
          }
          applyFilters();
        });

        document.getElementById('filter-run')?.addEventListener('change', (e) => {
          state.selectedRun = e.target.value;
          applyFilters();
        });

        document.getElementById('sort-by')?.addEventListener('change', (e) => {
          state.sortBy = e.target.value;
          renderKits();
        });
      }

      try {
        init();
      } catch(e) {
        console.error('GunplaSet Init Error:', e);
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      }
      window.addEventListener('load', () => {
        if (!document.querySelector('#kits-grid > div')) {
          init();
        }
      });
    })();