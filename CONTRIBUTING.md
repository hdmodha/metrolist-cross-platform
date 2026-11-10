# Contributing to Metrolist Cross-Platform

Thank you for contributing to **Metrolist**! This project provides a fast, ad-free, cross-platform music player powered by YouTube Music (`InnerTube WEB_REMIX`) for **macOS, Windows, Android, iOS, and Web**.

---

## 1. Getting Started (Local Setup)

1. **Fork & Clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/metrolist.git
   cd metrolist
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Run the development server** (starts both the Express InnerTube proxy and Vite frontend on `http://localhost:3000`):
   ```bash
   npm run dev
   ```

---

## 2. Running Tests & Type Checks

Before opening a Pull Request, please ensure all unit tests and TypeScript checks pass:

```bash
# Run every unit test (player core, queue rules, InnerTube parsers, persistence, security)
npm test

# Run TypeScript type checking
npm run lint

# Verify production build
npm run build
```

---

## 3. Building Native Packages Locally

### Android (`.apk`) & iOS (`.ipa` / Xcode) via Capacitor
```bash
npm run build
npm install --no-save @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios
npx cap sync

# Open in Android Studio to build APK/AAB:
npx cap open android

# Open in Xcode (macOS) to build iOS app:
npx cap open ios
```

---

## 4. Submitting a Pull Request

1. Create a feature branch (`git checkout -b feat/your-feature-name`).
2. Commit your changes with a clear description (`git commit -m "feat: add ..."`).
3. Push to your fork (`git push origin feat/your-feature-name`) and open a Pull Request against `main`.
