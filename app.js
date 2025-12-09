// --- State Management ---
// ⚠️ توجه: db و storage به صورت گلوبال از index.html دریافت می‌شوند.

const USER_ID_KEY = 'current_user_id'; 
const WINNER_KEY = 'current_family_fund_winner'; 

// 🔑 کلیدهای ذخیره رمز عبور (هنوز در LocalStorage)
const ADMIN_PASS_KEY = 'admin_password_storage';
const USER_PASS_KEY = 'user_password_storage';

// 🔑 رمز عبور پیش‌فرض
const DEFAULT_ADMIN_PASSWORD = 'm2284147216'; 
const DEFAULT_USER_PASSWORD = '123'; 

// 🔑 خواندن رمزهای عبور از LocalStorage، یا تنظیم پیش‌فرض
let ADMIN_PASSWORD = localStorage.getItem(ADMIN_PASS_KEY) || DEFAULT_ADMIN_PASSWORD;
let USER_PASSWORD = localStorage.getItem(USER_PASS_KEY) || DEFAULT_USER_PASSWORD;

// ذخیره رمزهای پیش‌فرض اگر هنوز در LocalStorage نباشند
if (!localStorage.getItem(ADMIN_PASS_KEY)) {
     localStorage.setItem(ADMIN_PASS_KEY, DEFAULT_ADMIN_PASSWORD);
     ADMIN_PASSWORD = DEFAULT_ADMIN_PASSWORD;
}
if (!localStorage.getItem(USER_PASS_KEY)) {
     localStorage.setItem(USER_PASS_KEY, DEFAULT_USER_PASSWORD);
     USER_PASSWORD = DEFAULT_USER_PASSWORD;
}

let members = []; // اعضا مستقیماً از Firestore بارگذاری می شوند
let monthlyArchives = JSON.parse(localStorage.getItem('family_fund_v4_monthly_archive')) || []; // آرشیو همچنان در LocalStorage
 
let currentUserId = localStorage.getItem(USER_ID_KEY);
let currentUser; // این با بارگذاری داده ها مقداردهی می شود

let currentWinnerData;
try { currentWinnerData = JSON.parse(localStorage.getItem(WINNER_KEY)); } catch (e) { currentWinnerData = null; }
 
let activeArchiveMonth = null; 

// 🎁 تابع کمکی برای گرفتن نام ماه فارسی و کد منحصر به فرد
function getCurrentPersianMonthInfo() {
    // این اطلاعات باید به صورت دستی در ابتدای هر ماه جدید آپدیت شود!
    const currentYear = '1404'; 
    const currentMonthName = 'آذر';
    const currentMonthNumber = 9; 
    const monthCode = `${currentYear}-${currentMonthNumber}`;
    return { monthName: currentMonthName, year: currentYear, monthNumber: currentMonthNumber, monthCode };
}

// تابع کمکی برای تبدیل تاریخ میلادی (Date.now()) به شمسی ساده
function toPersianDate(timestamp) {
    if (!timestamp) return 'نامشخص';
    const date = new Date(parseInt(timestamp));
    return date.toLocaleDateString('fa-IR', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).replace('،', ' ');
}


// --- Firebase Read/Write Utilities ---
// تابع برای ذخیره آرشیو ماهانه (تنها چیزی که در LocalStorage می ماند)
function saveArchives() {  
    localStorage.setItem('family_fund_v4_monthly_archive', JSON.stringify(monthlyArchives));
}

// 🌐 بارگذاری اعضا از Firestore
async function loadMembers() {
    try {
        // چون getDoc را در index.html ایمپورت کرده‌ایم، باید آن را در اینجا به صورت گلوبال در نظر بگیریم.
        // برای این فایل، فرض می‌کنیم همه توابع از index.html در دسترس هستند.
        const membersCollection = collection(db, "members");
        const memberSnapshot = await getDocs(membersCollection);
        
        // تبدیل snapshot به آرایه اعضا و افزودن شناسه (doc.id) به هر عضو
        members = memberSnapshot.docs.map(doc => ({
             id: doc.id,
             ...doc.data(),
             // تضمین فیلدهای جدید برای کدهای قدیمی
             isVerified: doc.data().isVerified === undefined ? false : doc.data().isVerified,
             isPaid: doc.data().isPaid === undefined ? false : doc.data().isPaid,
             receipts: doc.data().receipts || [],
             nudgeCount: doc.data().nudgeCount || 0,
        }));
        
        // به‌روزرسانی کاربر جاری
        currentUser = members.find(m => m.id === currentUserId);
        
        render(); // رندر کردن کل صفحه پس از بارگذاری داده ها
        return true;
    } catch (e) {
        console.error("Error loading members: ", e);
        showToast('❌ خطایی در بارگذاری اطلاعات از دیتابیس رخ داد.');
        return false;
    }
}

// 🌐 به‌روزرسانی وضعیت یک عضو در Firestore
async function updateMember(memberId, data) {
    try {
        const memberRef = doc(db, "members", memberId);
        await updateDoc(memberRef, data);
        await loadMembers(); // بارگذاری مجدد اطلاعات
        return true;
    } catch (e) {
        console.error("Error updating member: ", e);
        showToast('❌ خطایی در به‌روزرسانی وضعیت عضو رخ داد.');
        return false;
    }
}

// 🌐 حذف یک عضو
async function deleteMember(memberId) {
    try {
        await deleteDoc(doc(db, "members", memberId));
        await loadMembers();
        return true;
    } catch (e) {
        console.error("Error deleting member: ", e);
        showToast('❌ خطایی در حذف عضو رخ داد.');
        return false;
    }
}

// 🌐 پاکسازی کامل دیتابیس (فقط برای ادمین)
async function resetAllData() {
    if (!confirm("⚠️ اخطار! آیا مطمئنید که می‌خواهید تمام داده‌های اعضا، برندگان و آرشیو ماهانه را به صورت کامل پاک کنید؟ این کار قابل برگشت نیست!")) {
        return;
    }

    try {
        // 1. پاکسازی Local Storage (آرشیو و رمزها)
        localStorage.removeItem('family_fund_v4_monthly_archive');
        localStorage.removeItem(WINNER_KEY);
        localStorage.removeItem(USER_ID_KEY);

        // 2. حذف تمام اعضا از Firestore
        const membersCollection = collection(db, "members");
        const memberSnapshot = await getDocs(membersCollection);
        const deletePromises = memberSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        
        // 3. حذف سند برنده ماه از تنظیمات
        const winnerRef = doc(db, "settings", "winner");
        await deleteDoc(winnerRef);
        
        // ⚠️ توجه: حذف فایل ها در Storage پیچیده تر است و نیاز به کد سمت سرور دارد. برای سادگی، این بخش را موقتاً در کلاینت حذف می کنیم.

        members = [];
        monthlyArchives = [];
        currentWinnerData = null;
        currentUser = null;
        currentUserId = null;
        
        showToast('✅ تمامی داده‌ها با موفقیت پاک شدند!');
        window.location.reload(); // رفرش کامل صفحه
    } catch (e) {
        console.error("Error resetting all data: ", e);
        showToast('❌ خطایی در پاکسازی کامل داده‌ها رخ داد.');
    }
}

// 🌐 ذخیره برنده ماه
async function saveWinner(winnerData) {
    try {
        // از یک Document با نام ثابت 'winner' در یک Collection به نام 'settings' استفاده می کنیم
        const winnerRef = doc(db, "settings", "winner");
        await setDoc(winnerRef, winnerData);
        currentWinnerData = winnerData;
        await loadMembers(); // برای به‌روزرسانی لیست
        showToast('🏆 برنده ماه با موفقیت ذخیره شد.');
    } catch (e) {
        console.error("Error saving winner: ", e);
        showToast('❌ خطایی در ذخیره برنده ماه رخ داد.');
    }
}

// 🌐 بارگذاری برنده ماه
async function loadWinner() {
    try {
        // از doc و getDoc برای خواندن یک سند مشخص استفاده می کنیم
        const winnerRef = doc(db, "settings", "winner");
        const docSnap = await getDoc(winnerRef);

        if (docSnap.exists()) {
            currentWinnerData = docSnap.data();
        } else {
            currentWinnerData = null;
        }
        renderSidebar();
    } catch (e) {
        console.error("Error loading winner: ", e);
    }
}


// --- Logic Functions ---

// 🔑 تابع جدید: ورود کاربران عمومی
function checkUserPassword(e) {
    e.preventDefault();
    const inputPass = document.getElementById('userPassword').value;

    if (inputPass === USER_PASSWORD) {
        localStorage.setItem('userLoggedIn', 'true');
        document.getElementById('userLoginModal').style.display = 'none';
        document.getElementById('mainAppContainer').style.display = 'block';
        document.getElementById('countdownContainer').style.display = 'block';
        document.getElementById('mainNavBar').style.display = 'flex';
        showToast('ورود موفقیت‌آمیز. خوش آمدید.');
        loadMembers(); 
    } else {
        showToast('❌ رمز عبور اشتباه است.');
        document.getElementById('userPassword').value = '';
    }
}

// 🔑 تابع جدید: تغییر رمز عبور کاربران عمومی
function changeUserPassword(e) {
     e.preventDefault();
     const newPass = document.getElementById('newUserPassword').value;
     
     if (newPass.length < 3) {
         showToast('رمز عبور باید حداقل 3 کاراکتر باشد.');
         return;
     }

     if (confirm(`آیا مطمئن هستید که رمز عبور عمومی را به "${newPass}" تغییر می‌دهید؟`)) {
         USER_PASSWORD = newPass;
         localStorage.setItem(USER_PASS_KEY, newPass);
         document.getElementById('newUserPassword').value = '';
         showToast('✅ رمز عبور عمومی با موفقیت تغییر کرد.');
     }
}

// 🔑 تابع جدید: ورود به پنل ادمین
function checkAdminPassword(e) {
     e.preventDefault();
     const inputPass = document.getElementById('adminPassword').value;

     if (inputPass === ADMIN_PASSWORD) {
         document.getElementById('passwordForm').style.display = 'none';
         document.getElementById('adminContent').style.display = 'block';
         showToast('✅ ورود به پنل مدیریت موفقیت‌آمیز.');
         renderAdminPanel();
     } else {
         showToast('❌ رمز عبور اشتباه است.');
         document.getElementById('adminPassword').value = '';
     }
}

// 🔑 تابع جدید: تغییر رمز عبور پنل مدیریت
function changeAdminPassword(e) {
     e.preventDefault();
     const newPass = document.getElementById('newAdminPassword').value;
     
     if (newPass.length < 3) {
         showToast('رمز عبور باید حداقل 3 کاراکتر باشد.');
         return;
     }

     if (confirm(`آیا مطمئن هستید که رمز عبور ادمین را به "${newPass}" تغییر می‌دهید؟`)) {
         ADMIN_PASSWORD = newPass;
         localStorage.setItem(ADMIN_PASS_KEY, newPass);
         document.getElementById('newAdminPassword').value = '';
         showToast('✅ رمز عبور ادمین با موفقیت تغییر کرد.');
     }
}


function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('active');
    document.querySelector('.sidebar-overlay').classList.toggle('active');
}

function showAdminPanel() {
    document.getElementById('mainAppContainer').style.display = 'none';
    document.getElementById('countdownContainer').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    // اگر ادمین لاگین نبود، مودال ورود نمایش داده می شود
    if (document.getElementById('adminContent').style.display !== 'block') {
         document.getElementById('passwordForm').style.display = 'block';
         document.getElementById('adminContent').style.display = 'none';
    } else {
         renderAdminPanel();
    }
}

function hideAdminPanel() {
    document.getElementById('adminPanel').style.display = 'none';
    document.getElementById('mainAppContainer').style.display = 'block';
    document.getElementById('countdownContainer').style.display = 'block';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMsg').innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function openModal(id) {
    document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
    // پاک کردن فیش‌های قبلی
    if (id === 'uploadModal') {
        document.getElementById('uploadFile').value = '';
    }
}

// 🌐 تابع اصلی ثبت نام جدید
async function handleJoin(e) { 
    e.preventDefault();
    const name = document.getElementById('joinName').value.trim();
    const phone = document.getElementById('joinPhone').value.trim();

    if (!name || !phone) return;
    
    // چک کردن تکراری نبودن شماره (در صورت وجود، به عنوان کاربر فعلی لاگین شود)
    const existingMember = members.find(m => m.phone === phone);
    if (existingMember) {
        showToast('❌ شما قبلاً ثبت نام کرده‌اید. ورود خودکار انجام شد.');
        localStorage.setItem(USER_ID_KEY, existingMember.id);
        currentUserId = existingMember.id;
        currentUser = existingMember;
        closeModal('joinModal');
        render();
        return;
    }

    const newMember = {
        name: name,
        phone: phone,
        isVerified: false, // 👈 نیاز به تایید ادمین
        isPaid: false, 
        isAdmin: false,
        nudgeCount: 0,
        receipts: [],
        timestamp: Date.now()
    };

    try {
        // 🚨 ارسال به Firestore: Collection (جدول) با نام 'members'
        const docRef = await addDoc(collection(db, "members"), newMember);
        
        // ذخیره شناسه Firebase برای کاربر جاری در Local Storage
        localStorage.setItem(USER_ID_KEY, docRef.id); 
        currentUserId = docRef.id;
        currentUser = { ...newMember, id: docRef.id }; // به‌روزرسانی کاربر جاری
        
        closeModal('joinModal');
        showToast('✅ ثبت نام با موفقیت انجام شد. منتظر تأیید ادمین باشید.');
        await loadMembers(); // رفرش داده ها
    } catch (e) {
        console.error("Error adding document: ", e);
        showToast('❌ خطایی در ثبت نام رخ داد.');
    }
}


// 🌐 آپلود فایل رسید در Firebase Storage
async function handleUpload(e) {
    e.preventDefault();
    const fileInput = document.getElementById('uploadFile');
    const memberId = document.getElementById('uploadUserId').value;
    const file = fileInput.files[0];

    if (!file || !memberId) return;

    try {
        // 1. آپلود فایل در Storage
        const storageRef = ref(storage, `receipts/${memberId}/${Date.now()}_${file.name}`);
        const uploadTask = await uploadBytes(storageRef, file);
        const fileURL = await getDownloadURL(uploadTask.ref);

        // 2. به‌روزرسانی اطلاعات عضو در Firestore
        const member = members.find(m => m.id === memberId);
        if (!member) throw new Error("Member not found");

        const newReceipt = { 
            data: fileURL, 
            date: toPersianDate(Date.now()), 
            timestamp: Date.now() 
        };
        
        const updatedReceipts = [...member.receipts, newReceipt];

        // به‌روزرسانی وضعیت و لیست رسیدها
        await updateMember(memberId, { 
            receipts: updatedReceipts,
            isPaid: false // تا زمانی که ادمین تأیید نکند، وضعیت پرداخت باید "در انتظار تأیید" بماند
        });

        closeModal('uploadModal');
        showToast('✅ فیش واریزی با موفقیت ارسال شد. منتظر تأیید ادمین باشید.');

    } catch (e) {
        console.error("Error uploading receipt: ", e);
        showToast('❌ خطایی در ارسال فیش رخ داد.');
    }
}


// 🌐 نمایش آخرین رسید واریزی
function showReceipt(receiptURL) {
    if (receiptURL) {
        document.getElementById('receiptImg').src = receiptURL;
        openModal('receiptModal');
    } else {
        showToast('⚠️ فیش واریزی یافت نشد.');
    }
}

// --- Render Functions ---

function render() {
    renderMembersList();
    renderSidebar();
    // این تابع در اینجا فراخوانی می شود تا داده های برنده نیز به روز شود
    loadWinner();
}


function renderMembersList() {
    const membersListDiv = document.getElementById('membersList');
    const totalFundDiv = document.getElementById('totalFund');
    const totalMembersDiv = document.getElementById('totalMembers');
    
    // فیلتر کردن اعضای تأیید شده برای نمایش عمومی
    const verifiedMembers = members.filter(m => m.isVerified);
    
    membersListDiv.innerHTML = '';

    if (verifiedMembers.length === 0) {
        document.getElementById('emptyState').style.display = 'block';
    } else {
        document.getElementById('emptyState').style.display = 'none';

        verifiedMembers.forEach(member => {
            let statusBadge = '';
            let lastReceiptURL = member.receipts.length > 0 ? member.receipts[member.receipts.length - 1].data : null;
            
            if (!member.isVerified) {
                statusBadge = `<span class="status-badge status-awaiting-approval">در انتظار تأیید عضویت</span>`;
            } else if (member.isPaid) {
                statusBadge = `<span class="status-badge status-paid">✅ پرداخت شد</span>`;
            } else if (lastReceiptURL) {
                statusBadge = `<span class="status-badge status-awaiting-approval">⏳ در انتظار تأیید فیش</span>`;
            } else {
                statusBadge = `<span class="status-badge status-unpaid">❌ پرداخت نشده</span>`;
            }
            
            const memberCard = document.createElement('div');
            memberCard.className = 'member-card';
            memberCard.innerHTML = `
                <div class="member-header">
                    <div>
                        <div class="member-name">${member.name} ${member.isAdmin ? ' (ادمین)' : ''}</div>
                        <div class="member-phone">${member.phone}</div>
                    </div>
                    ${statusBadge}
                </div>
                <div class="action-row">
                    <button class="btn btn-upload" onclick="prepareUpload('${member.id}')">
                        ${member.isPaid ? 'ویرایش فیش' : 'ارسال فیش واریزی'}
                    </button>
                    <button class="btn btn-receipt ${lastReceiptURL ? 'btn-receipt' : 'btn-disabled'}" 
                        ${lastReceiptURL ? `onclick="showReceipt('${lastReceiptURL}')"` : 'disabled'}>
                        آخرین فیش
                    </button>
                    ${!member.isPaid ? `<button class="btn btn-nudge" onclick="nudgeMember('${member.id}')">
                        تذکر دادن (${member.nudgeCount})
                        <span class="nudge-count" style="display:none;">${member.nudgeCount}</span>
                    </button>` : ''}
                </div>
            `;
            
            const nudgeBtn = memberCard.querySelector('.btn-nudge');
            if(nudgeBtn && member.nudgeCount > 0){
                nudgeBtn.querySelector('.nudge-count').style.display = 'inline';
            }
            
            membersListDiv.appendChild(memberCard);
        });
    }

    // به‌روزرسانی آمار
    const paidCount = verifiedMembers.filter(m => m.isPaid).length;
    totalFundDiv.innerText = (paidCount * 1000000).toLocaleString('fa-IR') + ' تومان'; // فرض بر این است که سهم هر نفر ۱ میلیون تومان است
    totalMembersDiv.innerText = verifiedMembers.length.toLocaleString('fa-IR');
    
    // نمایش دکمه عضویت
    document.getElementById('btnJoinNav').style.display = currentUserId ? 'none' : 'block';
    
    // به‌روزرسانی نام ماه در تایمر
    document.querySelector('.countdown-header').innerHTML = `زمان باقی‌مانده تا پایان ماه **${getCurrentPersianMonthInfo().monthName}** و قرعه‌کشی`;
}

// --- Admin Panel Functions ---
// 🌐 به‌روزرسانی وضعیت تأیید عضویت (فقط ادمین)
async function verifyMember(memberId) {
    if (confirm('آیا مطمئن هستید که این عضو را تأیید می‌کنید؟')) {
        await updateMember(memberId, { isVerified: true });
        showToast('✅ عضو با موفقیت تأیید شد.');
    }
}

// 🌐 به‌روزرسانی وضعیت تأیید پرداخت (فقط ادمین)
async function verifyPayment(memberId) {
    if (confirm('آیا مطمئن هستید که پرداخت این عضو را تأیید می‌کنید؟')) {
        await updateMember(memberId, { isPaid: true, nudgeCount: 0 }); // پاکسازی تذکرات
        showToast('✅ پرداخت با موفقیت تأیید شد.');
    }
}

// 🌐 نمایش تاریخچه رسیدها (فقط ادمین)
function showAdminReceipts(memberId) {
    const member = members.find(m => m.id === memberId);
    if (!member || member.receipts.length === 0) {
        showToast('⚠️ این عضو فیش واریزی ثبت نکرده است.');
        return;
    }

    const contentDiv = document.getElementById('receiptsHistoryContent');
    contentDiv.innerHTML = '';
    document.getElementById('adminReceiptsModalTitle').innerText = `تاریخچه رسیدهای ${member.name}`;

    member.receipts.forEach((receipt, index) => {
        const item = document.createElement('div');
        item.className = 'receipt-history-item';
        item.innerHTML = `
            <p><strong>رسید شماره ${index + 1}</strong> <span style="font-size:0.8rem; color:#6b7280;">(${receipt.date})</span></p>
            <img src="${receipt.data}" alt="رسید واریزی" onclick="window.open('${receipt.data}', '_blank')">
        `;
        contentDiv.appendChild(item);
    });

    openModal('adminReceiptsModal');
}

// 🌐 انتخاب برنده ماه (فقط ادمین)
async function selectWinner() {
    const verifiedPaidMembers = members.filter(m => m.isVerified && m.isPaid);
    
    if (verifiedPaidMembers.length === 0) {
        showToast('❌ برای قرعه‌کشی حداقل یک عضو با پرداخت تأیید شده لازم است.');
        return;
    }

    if (currentWinnerData && currentWinnerData.monthCode === getCurrentPersianMonthInfo().monthCode) {
        showToast('⚠️ برنده ماه جاری قبلاً انتخاب شده است.');
        return;
    }

    if (confirm(`آیا مطمئن هستید که قرعه‌کشی ماه ${getCurrentPersianMonthInfo().monthName} را انجام دهید؟`)) {
        const winnerIndex = Math.floor(Math.random() * verifiedPaidMembers.length);
        const winner = verifiedPaidMembers[winnerIndex];

        // 1. ثبت برنده
        const winnerData = {
            id: winner.id,
            name: winner.name,
            phone: winner.phone,
            timestamp: Date.now(),
            monthName: getCurrentPersianMonthInfo().monthName,
            monthCode: getCurrentPersianMonthInfo().monthCode,
        };
        await saveWinner(winnerData);
        
        // 2. پاکسازی لیست پرداخت‌ها و انتقال به آرشیو
        const currentMonthData = {
            monthCode: getCurrentPersianMonthInfo().monthCode,
            monthName: getCurrentPersianMonthInfo().monthName,
            winner: winnerData,
            members: members.map(m => ({ id: m.id, name: m.name, isPaid: m.isPaid, receiptsCount: m.receipts.length }))
        };
        monthlyArchives.push(currentMonthData);
        saveArchives(); // ذخیره در Local Storage

        // 3. ریست وضعیت پرداخت اعضای فعلی در Firestore
        const resetPromises = members.map(m => updateMember(m.id, { isPaid: false }));
        await Promise.all(resetPromises);
        
        showToast(`🏆 برنده ماه ${winner.name} است!`);
    }
}


function renderAdminPanel() {
    renderAdminMembersTable();
    renderMonthlyArchives();
    
    const { monthName, monthCode } = getCurrentPersianMonthInfo();
    document.getElementById('currentMonthName').innerText = monthName;
    document.getElementById('currentMonthTitle').innerText = `جدول مدیریت اعضای ماه ${monthName}`;
    
    // آمار داشبورد ادمین
    const paidCount = members.filter(m => m.isPaid).length;
    const awaitingCount = members.filter(m => !m.isVerified || (m.isVerified && !m.isPaid && m.receipts.length > 0)).length;
    const totalFund = (paidCount * 1000000).toLocaleString('fa-IR') + ' تومان';
    const newMemberCount = members.filter(m => !m.isVerified).length;
    
    document.getElementById('adminPaidCount').innerText = paidCount;
    document.getElementById('adminAwaitingCount').innerText = awaitingCount;
    document.getElementById('adminTotalFund').innerText = totalFund;
    document.getElementById('newMemberCount').innerText = newMemberCount;
    
    if (newMemberCount > 0) {
        document.getElementById('adminNotificationCard').style.display = 'block';
    } else {
        document.getElementById('adminNotificationCard').style.display = 'none';
    }
}

function renderAdminMembersTable() {
    const tableBody = document.getElementById('adminMembersTableBody');
    tableBody.innerHTML = '';

    members.sort((a, b) => {
         // ابتدا اعضای در انتظار تایید نمایش داده شوند
         if (!a.isVerified && b.isVerified) return -1;
         if (a.isVerified && !b.isVerified) return 1;
         // سپس اعضای دارای فیش در انتظار تایید
         if (a.receipts.length > 0 && !a.isPaid && (!b.receipts.length || b.isPaid)) return -1;
         if (b.receipts.length > 0 && !b.isPaid && (!a.receipts.length || a.isPaid)) return 1;
         return 0; // در بقیه موارد ترتیب فرقی ندارد
    });

    members.forEach(member => {
        let status = 'بدون وضعیت';
        let rowClass = '';
        let actions = [];
        let lastReceiptURL = member.receipts.length > 0 ? member.receipts[member.receipts.length - 1].data : null;

        if (!member.isVerified) {
            status = 'عضویت (در انتظار تأیید)';
            rowClass = 'pending-row';
            actions.push(`<button class="btn-admin btn-verify-member" onclick="verifyMember('${member.id}')">تأیید عضویت</button>`);
        } else if (!member.isPaid && lastReceiptURL) {
            status = 'پرداخت (در انتظار تأیید)';
            rowClass = 'pending-row';
            actions.push(`<button class="btn-admin btn-verify-payment" onclick="verifyPayment('${member.id}')">تأیید پرداخت</button>`);
        } else if (member.isPaid) {
            status = '✅ پرداخت شد';
        } else {
            status = '❌ پرداخت نشده';
            actions.push(`<button class="btn-admin btn-select-winner" onclick="nudgeMember('${member.id}')">تذکر</button>`);
        }
        
        if (lastReceiptURL) {
             actions.push(`<button class="btn-admin btn-receipt" onclick="showAdminReceipts('${member.id}')">فیش‌ها (${member.receipts.length})</button>`);
        }


        actions.push(`<button class="btn-admin btn-delete-member" onclick="if(confirm('آیا مطمئن هستید؟')){ deleteMember('${member.id}') }">حذف</button>`);
        
        const row = tableBody.insertRow();
        row.className = rowClass;
        row.innerHTML = `
            <td>${member.name}</td>
            <td>${member.phone}</td>
            <td style="text-align:center;">${status}</td>
            <td style="text-align:center;">${member.receipts.length}</td>
            <td style="text-align:center;">${member.nudgeCount || 0}</td>
            <td>${actions.join('')}</td>
        `;
    });
    
    // دکمه قرعه‌کشی را به صورت جداگانه اضافه کنید
    const lotteryButton = document.createElement('button');
    lotteryButton.className = 'btn-full';
    lotteryButton.style.cssText = 'background: var(--winner-color); margin-top: 20px;';
    lotteryButton.innerText = '🎁 انجام قرعه‌کشی ماه جاری';
    lotteryButton.onclick = selectWinner;
    
    // حذف دکمه قرعه‌کشی قدیمی اگر وجود دارد
    const oldLotteryButton = document.getElementById('lotteryBtn');
    if (oldLotteryButton) oldLotteryButton.remove();
    
    lotteryButton.id = 'lotteryBtn';
    document.getElementById('adminDashboard').appendChild(lotteryButton);

}

function renderMonthlyArchives() {
    const container = document.getElementById('monthlyArchivesContainer');
    container.innerHTML = '';
    
    monthlyArchives.sort((a, b) => b.monthCode.localeCompare(a.monthCode)); // جدیدترین اول

    monthlyArchives.forEach(archive => {
        const paidCount = archive.members.filter(m => m.isPaid).length;
        const totalFund = (paidCount * 1000000).toLocaleString('fa-IR');
        
        const box = document.createElement('div');
        box.className = 'monthly-archive-box';
        if (archive.monthCode === activeArchiveMonth) box.classList.add('active');
        box.onclick = () => showSummaryModal(archive.monthCode);
        
        box.innerHTML = `
            <div class="archive-header">
                <span>${archive.monthName} ${archive.winner ? `(برنده: ${archive.winner.name})` : ''}</span>
                <span style="color:var(--primary);">${archive.monthCode.split('-')[0]}</span>
            </div>
            <div class="archive-stats">
                ${paidCount} پرداخت موفق / ${archive.members.length} عضو (${totalFund} تومان)
            </div>
        `;
        container.appendChild(box);
    });
}

function showSummaryModal(monthCode) {
    const archive = monthlyArchives.find(a => a.monthCode === monthCode);
    if (!archive) return;

    activeArchiveMonth = monthCode;
    renderMonthlyArchives(); // برای نشان دادن حالت فعال
    
    document.getElementById('summaryTitle').innerText = `خلاصه ماه ${archive.monthName} ${archive.monthCode.split('-')[0]}`;
    const contentDiv = document.getElementById('summaryContent');
    contentDiv.innerHTML = '';

    const winnerHtml = archive.winner 
        ? `<p style="font-weight: 700; font-size: 1.1rem; color: var(--winner-color); text-align: center;">🏆 برنده ماه: ${archive.winner.name} (${archive.winner.phone})</p>`
        : '<p style="text-align: center;">برنده‌ای برای این ماه ثبت نشده است.</p>';

    const paidListHtml = archive.members
        .filter(m => m.isPaid)
        .map(m => `<div class="paid-item"><span class="paid-item-name">${m.name}</span><span class="paid-item-date">فیش: ${m.receiptsCount}</span></div>`)
        .join('');

    const unpaidListHtml = archive.members
        .filter(m => !m.isPaid)
        .map(m => `<div class="paid-item"><span class="paid-item-name" style="color:var(--red-text);">${m.name}</span><span class="paid-item-date">فیش: ${m.receiptsCount}</span></div>`)
        .join('');

    contentDiv.innerHTML = `
        ${winnerHtml}
        <div style="display:flex; gap:15px; margin-top:20px; margin-bottom: 20px;">
            <div class="summary-stat" style="border-left: 5px solid var(--green-text);">
                <h4>پرداختی‌های موفق</h4>
                <div style="font-size:1.4rem; font-weight:900; color:var(--green-text);">${archive.members.filter(m => m.isPaid).length}</div>
            </div>
            <div class="summary-stat" style="border-left: 5px solid var(--red-text);">
                <h4>پرداخت نشده</h4>
                <div style="font-size:1.4rem; font-weight:900; color:var(--red-text);">${archive.members.filter(m => !m.isPaid).length}</div>
            </div>
        </div>
        
        <h4 style="margin-top: 20px; border-bottom: 1px dashed #e5e7eb; padding-bottom: 5px;">لیست پرداخت شده:</h4>
        <div class="paid-list">${paidListHtml || '<p style="text-align:center; color:#999;">لیست خالی است.</p>'}</div>

        <h4 style="margin-top: 20px; border-bottom: 1px dashed #e5e7eb; padding-bottom: 5px;">لیست پرداخت نشده:</h4>
        <div class="paid-list">${unpaidListHtml || '<p style="text-align:center; color:#999;">لیست خالی است.</p>'}</div>
    `;

    openModal('summaryModal');
}

// --- Initial Setup ---

function prepareUpload(memberId) {
    document.getElementById('uploadUserId').value = memberId;
    openModal('uploadModal');
}

async function nudgeMember(memberId) {
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    
    const newCount = (member.nudgeCount || 0) + 1;
    await updateMember(memberId, { nudgeCount: newCount });
    
    showToast(`🔔 تذکر برای ${member.name} ارسال شد. (تذکر: ${newCount})`);
}

function scrollToTable() {
     const table = document.querySelector('.admin-table-container');
     if(table) table.scrollIntoView({ behavior: 'smooth' });
}

function renderSidebar() {
     const profileCard = document.getElementById('sidebarProfileCard');
     profileCard.innerHTML = '';
     
     if (currentUser) {
         profileCard.innerHTML = `
             <div class="user-profile-card">
                 <p style="font-weight: 700; font-size: 1rem;">👤 ${currentUser.name}</p>
                 <p style="font-size: 0.9rem; color: #6b7280;">📞 ${currentUser.phone}</p>
                 <button class="btn" style="background: #eef; color: var(--primary); margin-top: 10px;" onclick="logOutUser()">خروج</button>
             </div>
         `;
     } else {
         profileCard.innerHTML = `
              <p style="color:#666; text-align:center; padding-bottom: 10px;">وارد حساب خود نشده‌اید.</p>
              <button class="btn-full" onclick="openModal('userLoginModal')">ورود مجدد</button>
         `;
     }
     
     // نمایش برنده اخیر در سایدبار
     const winnerBox = document.getElementById('currentWinnerProfile');
     if (currentWinnerData) {
         winnerBox.innerHTML = `
              <p style="font-weight: 700; color: var(--winner-color); font-size: 1.1rem; margin-top: 0;">${currentWinnerData.name}</p>
              <p style="font-size: 0.8rem; color: #666; margin: 5px 0 0 0;">برنده ماه ${currentWinnerData.monthName}</p>
              <p style="font-size: 0.8rem; color: #666;">تاریخ قرعه‌کشی: ${toPersianDate(currentWinnerData.timestamp).split(' ')[0]}</p>
         `;
     } else {
         winnerBox.innerHTML = `
             <p style="font-size:0.9rem; color:#666; text-align:center;">هنوز برنده ماه جاری انتخاب نشده است.</p>
         `;
     }
}

function logOutUser() {
    if (confirm('آیا مطمئن هستید که می‌خواهید از حساب خود خارج شوید؟')) {
         localStorage.removeItem(USER_ID_KEY);
         currentUserId = null;
         currentUser = null;
         showToast('❌ با موفقیت از سیستم خارج شدید.');
         window.location.reload(); 
    }
}


// --- Initialization ---

// ⚠️ توابع اصلی Firestore (مانند collection، getDocs، addDoc، updateDoc، deleteDoc) 
// و Storage (مانند ref، uploadBytes، getDownloadURL) به صورت گلوبال 
// در فایل index.html توسط ماژول import شده‌اند.

// بررسی وضعیت لاگین کاربر
if (localStorage.getItem('userLoggedIn') === 'true') {
     document.getElementById('userLoginModal').style.display = 'none';
     document.getElementById('mainAppContainer').style.display = 'block';
     document.getElementById('countdownContainer').style.display = 'block';
     document.getElementById('mainNavBar').style.display = 'flex';
     loadMembers();
} else {
     document.getElementById('userLoginModal').style.display = 'flex';
}

// اگر کاربر لاگین بود، لود اولیه را انجام دهید
if (currentUserId) {
    loadMembers();
}

// اجرای تایمر شمارش معکوس
function updateCountdown() {
    // ⚠️ تاریخ پایان هر ماه باید به صورت دستی تنظیم شود
    // این تاریخ را هر ماه در ابتدای ماه جدید تغییر دهید!
    // مثال: پایان آذر 1404
    const targetDate = new Date('2025/12/21 23:59:59').getTime(); // 21 آذر

    const now = new Date().getTime();
    const distance = targetDate - now;

    if (distance < 0) {
        document.getElementById('countdownTimer').innerHTML = "قرعه‌کشی انجام شد! منتظر ماه بعد باشید.";
        return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    document.getElementById('timerDays').innerText = String(days).padStart(2, '0');
    document.getElementById('timerHours').innerText = String(hours).padStart(2, '0');
    document.getElementById('timerMinutes').innerText = String(minutes).padStart(2, '0');
    document.getElementById('timerSeconds').innerText = String(seconds).padStart(2, '0');
}

setInterval(updateCountdown, 1000);
updateCountdown();