const fs = require("fs");
const path = require("path");

const HttpError = require("../models/http-error");
const { validationResult } = require("express-validator");
const getCoordsForAddress = require("../util/location");
const Place = require("../models/place");
const User = require("../models/user");
const { default: mongoose } = require("mongoose");

const getPlaceById = async (req, res, next) => {
  // console.log("GET Request in Places");

  const placeId = req.params.pid;

  let place;
  try {
    place = await Place.findById(placeId);
  } catch (err) {
    const error = new HttpError(
      "Something went wrong, could not fin a place.",
      500
    );
    return next(error);
  }

  if (!place) {
    const error = new HttpError(
      "Could not find a place for the provided id.",
      404
    );
    return next(error);
  }

  res.json({ place: place.toObject({ getters: true }) });
  // toObject getters를 해주는 이유는 mongoose은 string으로 ID를 RETURN 하는 모든 document에 ID getter를 추가하는데
  // 일반적으로 우리가 object라고 부르는 getter와 같은 것들을 true로 줘서 mongoose가 id를 object로 추가하도록 해준다.
};

const getPlacesByUserID = async (req, res, next) => {
  console.log("GET Request in Places");
  const userId = req.params.uid;

  // let places;
  let userWithPlaces;
  try {
    userWithPlaces = await User.findById(userId).populate("places");
  } catch (err) {
    const error = new HttpError(
      "Fetcing places failed, please try again later",
      500
    );
    return next(error);
  }

  // if(!places || places.length === 0) {
  if (!userWithPlaces || userWithPlaces.places.length === 0) {
    return next(
      new HttpError("Could not find a places for the provided user id.", 404)
    );
  }

  res.json({
    places: userWithPlaces.places.map((place) =>
      place.toObject({ getters: true })
    ),
  });
};

const createPlace = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422);
    // throw를 사용하지 않는 이유는 async code를 사용하는 경우 express에서 throw가 제대로 작동을 하지않기때문에
    // 그래서 항상 next를 사용해야함.
    return next(
      new HttpError("Invalid inputs passes, please check your data.", 422)
    );
  }

  const { title, description, address } = req.body;

  let coordinates;
  // 여기서 try catch문을 사용한 이유는 getCoordsForAddress 내부에서 throw를 사용하고 있기 때문임
  try {
    coordinates = await getCoordsForAddress(address);
  } catch (error) {
    next(error);
  }

  const createdPlace = new Place({
    title,
    description,
    address,
    location: coordinates,
    image: req.file.path,
    creator: req.userData.userId,
  });

  let user;

  try {
    user = await User.findById(req.userData.userId);
  } catch (err) {
    const error = new HttpError(
      "Creatring place failed, please try again",
      500
    );
    return next(error);
  }

  if (!user) {
    const error = new HttpError("Could not find user for provided id", 404);
    return next(error);
  }

  console.log(user);

  // 기존의 dummy data를 mongoose의 db에 저장하는 save method로 교체
  try {
    // transaction 과 session이 필요한데 transaction은 독립된 파일에서 작성한 여러작업을 수행하거나 수행되지 않게 해주는 것이고 이 transaction은 session에 만들어짐
    // 여기서는 user나 place 둘중 하나라도 error가 나면 둘다 실행되지 못하게 하도록함
    // 참고로 collection을 원래 따로 만들지 않아도 mongoDB가 없으면 생성해주는데 session같은 경우는 직접 mongoDB에 collection을 만들어 줘야함
    const sess = await mongoose.startSession();
    sess.startTransaction();
    await createdPlace.save({ session: sess });
    user.places.push(createdPlace);
    await user.save({ session: sess });
    await sess.commitTransaction();
  } catch (err) {
    const error = new HttpError("Creating place failed, please try again", 500);
    return next(error);
  }

  res.status(201).json({ place: createdPlace });
};

const updatePlaceById = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passes, please check your data.", 422)
    );
  }

  const { title, description } = req.body;
  const placeId = req.params.pid;

  let place;
  try {
    place = await Place.findById(placeId);
  } catch (err) {
    const error = new HttpError(
      "Something went wrong, could not update place",
      500
    );

    return next(error);
  }

  if (place.creator.toString() !== req.userData.userId) {
    const error = new HttpError(
      "You are not allowed to edit this place.",
      403
    );

    return next(error);
  }

  place.title = title;
  place.description = description;

  try {
    await place.save();
  } catch (err) {
    const error = new HttpError(
      "Something went wrong, could not update place",
      500
    );

    return next(error);
  }

  // post하면 id가 자동으로 생성되는데 그 아이디에 쉽게 접근하기 위해서
  // toObject를하고 getters를 true로 줘서 JavaScript가 이해할 수 있게 만들어주는것
  res.status(200).json({ place: place.toObject({ getters: true }) });
};

const deletePlace = async (req, res, next) => {
  const placeId = req.params.pid;
  let place;
  try {
    // populate()는 다른 collection에 있는 관련된 데이터도 같이 지워주는 method
    place = await Place.findById(placeId).populate("creator");
  } catch (err) {
    const error = new HttpError(
      "Something went wrong, could not delete place",
      500
    );

    return next(error);
  }

  if (!place) {
    const error = new HttpError("Could not find place for this id.", 404);

    return next(error);
  }

  // 여기서 populate로 받아온 id는 이미 string이라 toString()을 해줄필요없음 
  if (place.creator.id !== req.userData.userId) {
    const error = new HttpError(
      "You are not allowed to delete this place.",
      403
    );

    return next(error);
  }

  const imagePath = place.image;

  try {
    const sess = await mongoose.startSession();
    sess.startTransaction();
    await place.remove({ session: sess });
    place.creator.places.pull(place);
    await place.creator.save({ sesstion: sess });
    await sess.commitTransaction();
  } catch (err) {
    const error = new HttpError(
      "Something went wrong, could not delete place",
      500
    );

    return next(error);
  }

  fs.unlink(imagePath, (err) => {
    console.log(err);
  });

  res.status(200).json({ message: "Deleted Place." });
};

exports.getPlaceById = getPlaceById;
exports.getPlacesByUserID = getPlacesByUserID;
exports.createPlace = createPlace;
exports.updatePlaceById = updatePlaceById;
exports.deletePlace = deletePlace;
