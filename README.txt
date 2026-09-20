SS BILLINGS - UPDATED VERSION

Files included:
- main.js
- preload.js
- index.html
- package.json

IMPORTANT:
Keep your existing license.js in the same project folder. It was not supplied in the uploaded code, so it was intentionally not replaced.
Keep your existing assets/icon.ico as well.

Changes:
1. Admin password can be changed dynamically from Admin page.
2. Salary report has improved error handling and correct month-end dates.
3. Trial users can activate at any time from the Activate License sidebar option.
4. Categories are shown one per row with Edit and Delete actions.
5. Category rename updates products using the old category name.
6. Category deletion is blocked when products still use that category.
7. Update Items and Remove Items are merged into Manage Items.
8. Manage Items has Edit, Barcode and Remove actions.
9. Add Product returns the generated serial number and barcode to the UI.
10. Receipt shop details use correct template interpolation.

Run:
npm install
npm start

Build:
npm run build
