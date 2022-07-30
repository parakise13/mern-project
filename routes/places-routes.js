const express = require("express");
const { check } = require("express-validator");

const placesContollers = require("../controllers/places-controllers");
const fileUpload = require("../middleware/file-upload");
const checkAuth = require("../middleware/check-auth");

const router = express.Router();

router.get("/:pid", placesContollers.getPlaceById);

router.get("/user/:uid", placesContollers.getPlacesByUserID);

// token 미들웨어를 여기서 실행하는 이유는 인증되지 않은 경우 하단의 post나 patch등의 작업을 하지못하게 보호하기위해서
router.use(checkAuth);

router.post(
  "/",
  fileUpload.single("image"),
  [
    check("title").not().isEmpty(),
    check("description").isLength({ min: 5 }),
    check("address").not().isEmpty(),
  ],
  placesContollers.createPlace
);

router.patch(
  "/:pid",
  [check("title").not().isEmpty(), check("description").isLength({ min: 5 })],
  placesContollers.updatePlaceById
);

router.delete("/:pid", placesContollers.deletePlace);

module.exports = router;
